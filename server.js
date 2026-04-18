const crypto = require("crypto");
const path = require("path");

const dotenv = require("dotenv");
const express = require("express");
const { OAuth2Client } = require("google-auth-library");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3000;
const mongoUri = process.env.MONGODB_URI;
const authSecret = process.env.AUTH_SECRET;
const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
const googleClient = googleClientId ? new OAuth2Client(googleClientId) : null;
const smtpHost = process.env.SMTP_HOST || "";
const smtpPort = Number(process.env.SMTP_PORT) || 465;
const smtpUser = process.env.SMTP_USER || "";
const smtpPass = process.env.SMTP_PASS || "";
const smtpSecure = String(process.env.SMTP_SECURE || "true").toLowerCase() !== "false";
const contactToEmail = process.env.CONTACT_TO_EMAIL || "";
const contactFromEmail = process.env.CONTACT_FROM_EMAIL || smtpUser || "";
let mongooseConnectionPromise = null;

if (!mongoUri) {
  throw new Error("Missing MONGODB_URI in environment.");
}

if (!authSecret) {
  throw new Error("Missing AUTH_SECRET in environment.");
}

const stateSchemaDefinition = {
  settings: {
    groupName: { type: String, default: "" },
    currency: { type: String, default: "INR" },
    defaultNote: { type: String, default: "" }
  },
  members: {
    type: [
      {
        id: { type: String, required: true },
        name: { type: String, required: true },
        contact: { type: String, default: "" }
      }
    ],
    default: []
  },
  expenses: {
    type: [
      {
        id: { type: String, required: true },
        description: { type: String, required: true },
        amount: { type: Number, required: true },
        paidBy: { type: String, required: true },
        participants: { type: [String], default: [] },
        splitType: { type: String, default: "equal" },
        shares: { type: mongoose.Schema.Types.Mixed, default: {} },
        date: { type: String, required: true },
        category: { type: String, default: "Other" },
        note: { type: String, default: "" },
        createdAt: { type: String, required: true }
      }
    ],
    default: []
  },
  payments: {
    type: [
      {
        id: { type: String, required: true },
        from: { type: String, required: true },
        to: { type: String, required: true },
        amount: { type: Number, required: true },
        date: { type: String, required: true },
        note: { type: String, default: "" },
        createdAt: { type: String, required: true }
      }
    ],
    default: []
  }
};

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    passwordHash: { type: String, default: "" },
    googleId: { type: String, unique: true, sparse: true }
  },
  { timestamps: true }
);

const userStateSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    state: {
      type: new mongoose.Schema(stateSchemaDefinition, { _id: false }),
      default: () => ({
        settings: { groupName: "", currency: "INR", defaultNote: "" },
        members: [],
        expenses: [],
        payments: []
      })
    }
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);
const UserState = mongoose.model("UserState", userStateSchema);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

async function connectToDatabase() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!mongooseConnectionPromise) {
    mongooseConnectionPromise = mongoose.connect(mongoUri);
  }

  try {
    await mongooseConnectionPromise;
    return mongoose.connection;
  } catch (error) {
    mongooseConnectionPromise = null;
    throw error;
  }
}

app.use("/api", async (_request, _response, next) => {
  try {
    await connectToDatabase();
    next();
  } catch (error) {
    next(error);
  }
});

function createDefaultState() {
  return {
    settings: {
      groupName: "",
      currency: "INR",
      defaultNote: ""
    },
    members: [],
    expenses: [],
    payments: []
  };
}

function sanitizeState(input) {
  if (!input || typeof input !== "object") {
    return createDefaultState();
  }

  return {
    settings: {
      groupName: typeof input.settings?.groupName === "string" ? input.settings.groupName : "",
      currency: typeof input.settings?.currency === "string" ? input.settings.currency : "INR",
      defaultNote: typeof input.settings?.defaultNote === "string" ? input.settings.defaultNote : ""
    },
    members: Array.isArray(input.members) ? input.members : [],
    expenses: Array.isArray(input.expenses) ? input.expenses : [],
    payments: Array.isArray(input.payments) ? input.payments : []
  };
}

function roundCurrency(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function formatCurrency(amount, currency = "INR") {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: currency || "INR",
    maximumFractionDigits: 2
  }).format(Number(amount || 0));
}

function formatShortDate(dateValue) {
  if (!dateValue) {
    return "N/A";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(dateValue));
}

function lookupMemberName(members, memberId) {
  return members.find((member) => member.id === memberId)?.name || "Unknown member";
}

function calculateBalancesForState(state) {
  const balances = new Map(state.members.map((member) => [member.id, 0]));

  state.expenses.forEach((expense) => {
    balances.set(expense.paidBy, roundCurrency((balances.get(expense.paidBy) || 0) + Number(expense.amount || 0)));
    Object.entries(expense.shares || {}).forEach(([participantId, share]) => {
      balances.set(participantId, roundCurrency((balances.get(participantId) || 0) - Number(share || 0)));
    });
  });

  state.payments.forEach((payment) => {
    balances.set(payment.from, roundCurrency((balances.get(payment.from) || 0) + Number(payment.amount || 0)));
    balances.set(payment.to, roundCurrency((balances.get(payment.to) || 0) - Number(payment.amount || 0)));
  });

  return state.members
    .map((member) => ({
      id: member.id,
      name: member.name,
      balance: roundCurrency(balances.get(member.id) || 0)
    }))
    .sort((a, b) => b.balance - a.balance);
}

function calculateSettlementsForState(state) {
  const balances = calculateBalancesForState(state);
  const creditors = balances
    .filter((entry) => entry.balance > 0.009)
    .map((entry) => ({ ...entry }));
  const debtors = balances
    .filter((entry) => entry.balance < -0.009)
    .map((entry) => ({ ...entry, balance: Math.abs(entry.balance) }));

  const settlements = [];
  let creditorIndex = 0;
  let debtorIndex = 0;

  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex];
    const debtor = debtors[debtorIndex];
    const amount = roundCurrency(Math.min(creditor.balance, debtor.balance));

    settlements.push({
      from: debtor.name,
      to: creditor.name,
      amount
    });

    creditor.balance = roundCurrency(creditor.balance - amount);
    debtor.balance = roundCurrency(debtor.balance - amount);

    if (creditor.balance <= 0.009) {
      creditorIndex += 1;
    }

    if (debtor.balance <= 0.009) {
      debtorIndex += 1;
    }
  }

  return settlements;
}

function buildReportPdfBuffer(reportState, recipient) {
  const state = sanitizeState(reportState);
  const balances = calculateBalancesForState(state);
  const settlements = calculateSettlementsForState(state);
  const totalSpent = state.expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const totalPaidBack = state.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const openBalance = balances.reduce((sum, item) => sum + Math.abs(item.balance), 0) / 2;
  const currency = state.settings.currency || "INR";
  const title = state.settings.groupName || "SplitCircle Group";

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: "A4" });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const ensureSpace = (minY = 720) => {
      if (doc.y > minY) {
        doc.addPage();
      }
    };

    const sectionTitle = (text) => {
      ensureSpace(700);
      doc.moveDown(0.5);
      doc.font("Helvetica-Bold").fontSize(15).fillColor("#111827").text(text);
      doc.moveDown(0.25);
    };

    const lineItem = (label, value) => {
      ensureSpace(735);
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827").text(`${label}: `, { continued: true });
      doc.font("Helvetica").fontSize(10).fillColor("#374151").text(value);
    };

    doc.font("Helvetica-Bold").fontSize(22).fillColor("#111827").text("SplitCircle Expense Report");
    doc.moveDown(0.25);
    doc.font("Helvetica").fontSize(11).fillColor("#4b5563").text(`Group: ${title}`);
    doc.text(`Generated: ${formatShortDate(new Date().toISOString())}`);
    doc.text(`Sent to: ${recipient.email}`);

    sectionTitle("Overview");
    lineItem("Members", String(state.members.length));
    lineItem("Expenses", String(state.expenses.length));
    lineItem("Payments", String(state.payments.length));
    lineItem("Total spent", formatCurrency(totalSpent, currency));
    lineItem("Payments recorded", formatCurrency(totalPaidBack, currency));
    lineItem("Outstanding balance", formatCurrency(openBalance, currency));

    sectionTitle("Members");
    if (state.members.length === 0) {
      lineItem("Status", "No members added yet.");
    } else {
      state.members.forEach((member) => {
        ensureSpace(735);
        doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827").text(member.name);
        doc.font("Helvetica").fontSize(10).fillColor("#4b5563").text(member.contact || "No contact");
        doc.moveDown(0.2);
      });
    }

    sectionTitle("Balances");
    if (balances.length === 0) {
      lineItem("Status", "No balances available yet.");
    } else {
      balances.forEach((entry) => {
        const status = entry.balance > 0 ? "Should receive" : entry.balance < 0 ? "Needs to pay" : "Balanced";
        lineItem(entry.name, `${formatCurrency(Math.abs(entry.balance), currency)} | ${status}`);
      });
    }

    sectionTitle("Suggested Settlements");
    if (settlements.length === 0) {
      lineItem("Status", "No suggested settle-up needed right now.");
    } else {
      settlements.forEach((item) => {
        lineItem(`${item.from} -> ${item.to}`, formatCurrency(item.amount, currency));
      });
    }

    sectionTitle("Expenses");
    if (state.expenses.length === 0) {
      lineItem("Status", "No expenses recorded yet.");
    } else {
      state.expenses.forEach((expense, index) => {
        ensureSpace(690);
        doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827").text(`${index + 1}. ${expense.description}`);
        doc.font("Helvetica").fontSize(10).fillColor("#374151").text(
          `Amount: ${formatCurrency(expense.amount, currency)} | Paid by: ${lookupMemberName(state.members, expense.paidBy)} | Date: ${formatShortDate(expense.date)}`
        );
        doc.text(`Category: ${expense.category || "Other"} | Split: ${expense.splitType || "equal"}`);
        doc.text(`Participants: ${(expense.participants || []).map((id) => lookupMemberName(state.members, id)).join(", ") || "None"}`);
        if (expense.note) {
          doc.text(`Note: ${expense.note}`);
        }
        doc.moveDown(0.35);
      });
    }

    sectionTitle("Payments");
    if (state.payments.length === 0) {
      lineItem("Status", "No payments recorded yet.");
    } else {
      state.payments.forEach((payment, index) => {
        ensureSpace(705);
        doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827").text(
          `${index + 1}. ${lookupMemberName(state.members, payment.from)} paid ${lookupMemberName(state.members, payment.to)}`
        );
        doc.font("Helvetica").fontSize(10).fillColor("#374151").text(
          `Amount: ${formatCurrency(payment.amount, currency)} | Date: ${formatShortDate(payment.date)}`
        );
        if (payment.note) {
          doc.text(`Note: ${payment.note}`);
        }
        doc.moveDown(0.35);
      });
    }

    doc.end();
  });
}

function createMailTransport() {
  if (!smtpHost || !smtpPort || !smtpUser || !smtpPass || !contactToEmail || !contactFromEmail) {
    return null;
  }

  return nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, originalHash] = String(storedHash).split(":");
  if (!salt || !originalHash) {
    return false;
  }

  const currentHash = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(originalHash, "hex"), Buffer.from(currentHash, "hex"));
}

function createToken(userId) {
  const payload = Buffer.from(JSON.stringify({
    sub: String(userId),
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000
  })).toString("base64url");
  const signature = crypto
    .createHmac("sha256", authSecret)
    .update(payload)
    .digest("base64url");

  return `${payload}.${signature}`;
}

function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return null;
  }

  const [payload, signature] = token.split(".");
  const expectedSignature = crypto
    .createHmac("sha256", authSecret)
    .update(payload)
    .digest("base64url");

  if (signature !== expectedSignature) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!decoded.sub || !decoded.exp || decoded.exp < Date.now()) {
      return null;
    }

    return decoded;
  } catch (error) {
    return null;
  }
}

async function requireUser(request, response, next) {
  const authorization = request.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : null;
  const payload = verifyToken(token);

  if (!payload) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  const user = await User.findById(payload.sub).lean();
  if (!user) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  request.user = user;
  next();
}

async function ensureUserState(userId) {
  const existingState = await UserState.findOne({ userId }).lean();
  if (!existingState) {
    await UserState.create({
      userId,
      state: createDefaultState()
    });
  }
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/test", (_request, response) => {
  response.json({ message: "Test API works!" });
});

app.get("/api/config", (_request, response) => {
  response.json({
    googleClientId
  });
});

app.post("/api/auth/signup", async (request, response) => {
  const name = String(request.body?.name || "").trim();
  const email = String(request.body?.email || "").trim().toLowerCase();
  const password = String(request.body?.password || "");

  if (!name || !email || password.length < 6) {
    response.status(400).json({ error: "Name, email, and a password of at least 6 characters are required." });
    return;
  }

  const existingUser = await User.findOne({ email }).lean();
  if (existingUser) {
    response.status(409).json({ error: "An account already exists for that email." });
    return;
  }

  const user = await User.create({
    name,
    email,
    passwordHash: createPasswordHash(password)
  });

  await UserState.create({
    userId: user._id,
    state: createDefaultState()
  });

  response.status(201).json({
    token: createToken(user._id),
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email
    }
  });
});

app.post("/api/auth/google", async (request, response) => {
  const credential = String(request.body?.credential || "");
  if (!googleClient || !googleClientId) {
    response.status(503).json({ error: "Google login is not configured on the server yet." });
    return;
  }

  if (!credential) {
    response.status(400).json({ error: "Missing Google credential." });
    return;
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: googleClientId
    });
    const payload = ticket.getPayload();
    const email = String(payload?.email || "").trim().toLowerCase();
    const name = String(payload?.name || "Google User").trim();
    const googleId = String(payload?.sub || "");

    if (!email || !googleId) {
      response.status(400).json({ error: "Google account did not return the required profile details." });
      return;
    }

    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({
        name,
        email,
        googleId
      });
    } else {
      let shouldSave = false;
      if (!user.googleId) {
        user.googleId = googleId;
        shouldSave = true;
      }
      if (!user.name && name) {
        user.name = name;
        shouldSave = true;
      }
      if (shouldSave) {
        await user.save();
      }
    }

    await ensureUserState(user._id);

    response.json({
      token: createToken(user._id),
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    response.status(401).json({ error: "Google sign-in failed. Please try again." });
  }
});

app.post("/api/auth/login", async (request, response) => {
  const email = String(request.body?.email || "").trim().toLowerCase();
  const password = String(request.body?.password || "");

  if (!email || !password) {
    response.status(400).json({ error: "Email and password are required." });
    return;
  }

  const user = await User.findOne({ email });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    response.status(401).json({ error: "Invalid email or password." });
    return;
  }

  response.json({
    token: createToken(user._id),
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email
    }
  });
});

app.post("/api/contact", async (request, response) => {
  const name = String(request.body?.name || "").trim();
  const email = String(request.body?.email || "").trim();
  const message = String(request.body?.message || "").trim();

  if (!name || !email || !message) {
    response.status(400).json({ error: "Name, email, and message are required." });
    return;
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    response.status(400).json({ error: "Please enter a valid email address." });
    return;
  }

  if (message.length < 10) {
    response.status(400).json({ error: "Please write a slightly longer message." });
    return;
  }

  const transporter = createMailTransport();
  if (!transporter) {
    response.status(503).json({ error: "Contact email is not configured on the server yet." });
    return;
  }

  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeMessage = escapeHtml(message).replace(/\r?\n/g, "<br>");

  await transporter.sendMail({
    from: `"SplitCircle Contact" <${contactFromEmail}>`,
    to: contactToEmail,
    replyTo: email,
    subject: `New SplitCircle contact message from ${name}`,
    text: [
      "New SplitCircle contact message",
      "",
      `Name: ${name}`,
      `Email: ${email}`,
      "",
      "Message:",
      message
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
        <h2 style="margin-bottom: 12px;">New SplitCircle contact message</h2>
        <p><strong>Name:</strong> ${safeName}</p>
        <p><strong>Email:</strong> ${safeEmail}</p>
        <p><strong>Message:</strong></p>
        <div style="padding: 12px 14px; border-radius: 12px; background: #f3f4f6;">${safeMessage}</div>
      </div>
    `
  });

  response.status(201).json({ ok: true });
});

app.post("/api/report/email", requireUser, async (request, response) => {
  const transporter = createMailTransport();
  if (!transporter) {
    response.status(503).json({ error: "Email delivery is not configured on the server yet." });
    return;
  }

  const userState = await UserState.findOne({ userId: request.user._id }).lean();
  const reportState = sanitizeState(userState?.state);
  const pdfBuffer = await buildReportPdfBuffer(reportState, request.user);
  const groupName = reportState.settings.groupName || "splitcircle-group";
  const safeGroupName = groupName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "splitcircle-group";

  await transporter.sendMail({
    from: `"SplitCircle Reports" <${contactFromEmail}>`,
    to: request.user.email,
    replyTo: contactToEmail,
    subject: `Your SplitCircle report for ${groupName}`,
    text: [
      `Hello ${request.user.name || "there"},`,
      "",
      "Your latest SplitCircle report is attached as a PDF.",
      "It includes group details, balances, expenses, payments, and settle-up suggestions.",
      "",
      "Thanks,",
      "SplitCircle"
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
        <h2 style="margin-bottom: 12px;">Your SplitCircle report is ready</h2>
        <p>Hello ${escapeHtml(request.user.name || "there")},</p>
        <p>Your latest group expense report is attached as a PDF.</p>
        <p>It includes members, balances, expenses, payments, and settle-up suggestions.</p>
      </div>
    `,
    attachments: [
      {
        filename: `${safeGroupName}-report.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf"
      }
    ]
  });

  response.status(201).json({ ok: true, email: request.user.email });
});

app.get("/api/auth/me", requireUser, async (request, response) => {
  response.json({
    user: {
      id: String(request.user._id),
      name: request.user.name,
      email: request.user.email
    }
  });
});

app.get("/api/state", requireUser, async (request, response) => {
  let userState = await UserState.findOne({ userId: request.user._id }).lean();

  if (!userState) {
    userState = await UserState.create({
      userId: request.user._id,
      state: createDefaultState()
    });
  }

  response.json({ state: sanitizeState(userState.state) });
});

app.put("/api/state", requireUser, async (request, response) => {
  const sanitizedState = sanitizeState(request.body?.state);

  await UserState.findOneAndUpdate(
    { userId: request.user._id },
    { state: sanitizedState },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  response.json({ state: sanitizedState });
});

async function start() {
  await connectToDatabase();
  app.listen(port, () => {
    console.log(`SplitCircle server running on http://localhost:${port}`);
  });
}

app.use((error, _request, response, _next) => {
  console.error("Request failed:", error);
  response.status(500).json({ error: "Internal server error." });
});

module.exports = app;

if (require.main === module) {
  start().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
}
