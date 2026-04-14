const crypto = require("crypto");
const path = require("path");

const dotenv = require("dotenv");
const express = require("express");
const { OAuth2Client } = require("google-auth-library");
const mongoose = require("mongoose");

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3000;
const mongoUri = process.env.MONGODB_URI;
const authSecret = process.env.AUTH_SECRET;
const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
const rootDir = __dirname;
const googleClient = googleClientId ? new OAuth2Client(googleClientId) : null;

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
app.use(express.static(rootDir));

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

app.get("*", (request, response) => {
  const requestedPath = request.path === "/" ? "index.html" : request.path.slice(1);
  response.sendFile(path.join(rootDir, requestedPath), (error) => {
    if (error) {
      response.status(404).sendFile(path.join(rootDir, "index.html"));
    }
  });
});

async function start() {
  await mongoose.connect(mongoUri);
  app.listen(port, () => {
    console.log(`SplitCircle server running on http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
