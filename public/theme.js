(function applySavedCustomization() {
  var STORAGE_KEY = "split-circle-customization";
  var defaults = {
    theme: "midnight",
    surface: "glass",
    density: "comfy",
    radius: "soft",
    typeScale: "medium",
    motion: "full"
  };

  function readSettings() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? Object.assign({}, defaults, JSON.parse(raw)) : defaults;
    } catch (error) {
      return defaults;
    }
  }

  function applySettings(settings) {
    var root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.dataset.surface = settings.surface;
    root.dataset.density = settings.density;
    root.dataset.radius = settings.radius;
    root.dataset.typeScale = settings.typeScale;
    root.dataset.motion = settings.motion;
  }

  var currentSettings = readSettings();
  applySettings(currentSettings);

  window.SplitCircleCustomization = {
    storageKey: STORAGE_KEY,
    defaults: defaults,
    getSettings: readSettings,
    saveSettings: function saveSettings(nextSettings) {
      var merged = Object.assign({}, defaults, nextSettings);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      applySettings(merged);
      return merged;
    },
    resetSettings: function resetSettings() {
      localStorage.removeItem(STORAGE_KEY);
      applySettings(defaults);
      return Object.assign({}, defaults);
    },
    applySettings: applySettings
  };
})();
