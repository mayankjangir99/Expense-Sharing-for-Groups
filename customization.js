setupLogoutLinks();
setupProtectedLinks();

var customizationForm = document.getElementById("customizationForm");
var customizationMessage = document.getElementById("customizationMessage");
var resetCustomizationButton = document.getElementById("resetCustomization");

if (customizationForm && window.SplitCircleCustomization) {
  populateCustomizationForm(window.SplitCircleCustomization.getSettings());

  customizationForm.addEventListener("change", function () {
    var nextSettings = readCustomizationForm();
    window.SplitCircleCustomization.saveSettings(nextSettings);
    customizationMessage.textContent = "Customization saved across the site.";
  });
}

if (resetCustomizationButton && window.SplitCircleCustomization) {
  resetCustomizationButton.addEventListener("click", function () {
    var defaults = window.SplitCircleCustomization.resetSettings();
    populateCustomizationForm(defaults);
    customizationMessage.textContent = "Customization reset to default.";
  });
}

function populateCustomizationForm(settings) {
  var entries = Object.entries(settings);
  entries.forEach(function (entry) {
    var key = entry[0];
    var value = entry[1];
    var field = customizationForm.elements.namedItem(key);
    if (field) {
      field.value = value;
    }
  });
}

function readCustomizationForm() {
  return {
    theme: customizationForm.elements.namedItem("theme").value,
    surface: customizationForm.elements.namedItem("surface").value,
    density: customizationForm.elements.namedItem("density").value,
    radius: customizationForm.elements.namedItem("radius").value,
    typeScale: customizationForm.elements.namedItem("typeScale").value,
    motion: customizationForm.elements.namedItem("motion").value
  };
}
