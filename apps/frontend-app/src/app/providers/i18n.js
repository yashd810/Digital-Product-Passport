import React, { createContext, useContext, useState } from "react";

// ── Translation dictionaries ─────────────────────────────────
const translations = {
  en: {
    // Nav
    dashboard:        "Dashboard",
    overview:         "Overview",
    myPassports:      "My Passports",
    auditLogs:        "Audit Logs",
    workflow:         "Workflow",
    manageTeam:       "Manage Team",
    myProfile:        "My Profile",
    logout:           "Logout",
    // Auth
    login:            "Login",
    forgotPassword:   "Forgot Password?",
    resetPassword:    "Reset Password",
    sendResetLink:    "Send Reset Link",
    backToLogin:      "Back to Login",
    newPassword:      "New Password",
    confirmPassword:  "Confirm Password",
    // Passports
    createPassport:   "Create Passport",
    editPassport:     "Edit Passport",
    deletePassport:   "Delete",
    releasePassport:  "Release",
    revisePassport:   "Revise",
    viewPassport:     "View",
    draft:            "Draft",
    released:         "Released",
    revised:          "In Revision",
    inReview:         "In Review",
    inApproval:       "In Approval",
    passportType:     "Passport Type",
    modelName:        "Model Name",
    productId:        "Serial Number",
    version:          "Version",
    status:           "Status",
    createdBy:        "Created By",
    date:             "Date",
    completeness:     "Completeness",
    // Profile
    firstName:        "First Name",
    lastName:         "Last Name",
    email:            "Email",
    phone:            "Phone",
    jobTitle:         "Job Title",
    bio:              "Bio",
    profilePhoto:     "Profile Photo",
    changePassword:   "Change Password",
    saveChanges:      "Save Changes",
    // Notifications
    notifications:    "Notifications",
    markAllRead:      "Mark all read",
    noNotifications:  "No new notifications",
    // Workflow
    submitForReview:  "Submit for Review",
    approvePassport:  "Approve",
    rejectPassport:   "Reject",
    reviewer:         "Reviewer",
    approver:         "Approver",
    addComment:       "Add a comment",
    myBacklog:        "My Backlog",
    inProgress:       "In Progress",
    // Common
    save:             "Save",
    cancel:           "Cancel",
    delete:           "Delete",
    search:           "Search",
    loading:          "Loading…",
    error:            "Error",
    success:          "Success",
    back:             "Back",
    yes:              "Yes",
    no:               "No",
    optional:         "optional",
    // Consumer page
    viewFullPassport: "View full passport",
    verifiedProduct:  "Verified Product",
    scanAgain:        "Scan again",
    learnMore:        "Learn more",
    certifications:   "Certifications",
    sustainability:   "Sustainability",
    materials:        "Materials",
    safety:           "Safety",
    carbonFootprint:  "Carbon Footprint",
    recycled:         "Recycled content",
    // Theme
    theme:            "Theme",
    colorScheme:      "Color Scheme",
    language:         "Language",
    // Analytics
    totalPassports:   "Total Passports",
    draftCount:       "Draft",
    releasedCount:    "Released",
    revisedCount:     "In Revision",
    completenessAvg:  "Avg. Completeness",
    thisMonth:        "This Month",
    allTime:          "All Time",
    totalScans:       "Total Scans",
    recentActivity:   "Recent Activity",
    introduction:     "Introduction",
  },

  sv: {
    dashboard:        "Instrumentpanel",
    overview:         "Översikt",
    myPassports:      "Mina pass",
    auditLogs:        "Granskningsloggar",
    workflow:         "Arbetsflöde",
    manageTeam:       "Hantera team",
    myProfile:        "Min profil",
    logout:           "Logga ut",
    login:            "Logga in",
    forgotPassword:   "Glömt lösenord?",
    resetPassword:    "Återställ lösenord",
    sendResetLink:    "Skicka återställningslänk",
    backToLogin:      "Tillbaka till inloggning",
    newPassword:      "Nytt lösenord",
    confirmPassword:  "Bekräfta lösenord",
    createPassport:   "Skapa pass",
    editPassport:     "Redigera pass",
    deletePassport:   "Radera",
    releasePassport:  "Frigör",
    revisePassport:   "Revidera",
    viewPassport:     "Visa",
    draft:            "Utkast",
    released:         "Frigjord",
    revised:          "Under revidering",
    inReview:         "Under granskning",
    inApproval:       "Väntar godkännande",
    passportType:     "Passtyp",
    modelName:        "Modellnamn",
    productId:        "Produkt-ID",
    version:          "Version",
    status:           "Status",
    createdBy:        "Skapad av",
    date:             "Datum",
    completeness:     "Fullständighet",
    firstName:        "Förnamn",
    lastName:         "Efternamn",
    email:            "E-post",
    phone:            "Telefon",
    jobTitle:         "Jobbtitel",
    bio:              "Biografi",
    profilePhoto:     "Profilfoto",
    changePassword:   "Ändra lösenord",
    saveChanges:      "Spara ändringar",
    notifications:    "Aviseringar",
    markAllRead:      "Markera alla som lästa",
    noNotifications:  "Inga nya aviseringar",
    submitForReview:  "Skicka för granskning",
    approvePassport:  "Godkänn",
    rejectPassport:   "Avvisa",
    reviewer:         "Granskare",
    approver:         "Godkännare",
    addComment:       "Lägg till kommentar",
    myBacklog:        "Min kö",
    inProgress:       "Pågående",
    save:             "Spara",
    cancel:           "Avbryt",
    delete:           "Radera",
    search:           "Sök",
    loading:          "Läser in…",
    error:            "Fel",
    success:          "Lyckades",
    back:             "Tillbaka",
    yes:              "Ja",
    no:               "Nej",
    optional:         "valfritt",
    viewFullPassport: "Visa fullständigt pass",
    verifiedProduct:  "Verifierad produkt",
    scanAgain:        "Skanna igen",
    learnMore:        "Läs mer",
    certifications:   "Certifieringar",
    sustainability:   "Hållbarhet",
    materials:        "Material",
    safety:           "Säkerhet",
    carbonFootprint:  "Koldioxidavtryck",
    recycled:         "Återvunnet innehåll",
    theme:            "Tema",
    colorScheme:      "Färgschema",
    language:         "Språk",
    totalPassports:   "Totalt antal pass",
    draftCount:       "Utkast",
    releasedCount:    "Frigjorda",
    revisedCount:     "Under revidering",
    completenessAvg:  "Genomsn. fullständighet",
    thisMonth:        "Denna månad",
    allTime:          "Alltid",
    totalScans:       "Totalt antal skanningar",
    recentActivity:   "Senaste aktivitet",
    introduction:     "Introduktion",
  },

  de: {
    dashboard:        "Dashboard",
    overview:         "Übersicht",
    myPassports:      "Meine Pässe",
    auditLogs:        "Prüfprotokolle",
    workflow:         "Arbeitsablauf",
    manageTeam:       "Team verwalten",
    myProfile:        "Mein Profil",
    logout:           "Abmelden",
    login:            "Anmelden",
    forgotPassword:   "Passwort vergessen?",
    resetPassword:    "Passwort zurücksetzen",
    sendResetLink:    "Link senden",
    backToLogin:      "Zurück zur Anmeldung",
    newPassword:      "Neues Passwort",
    confirmPassword:  "Passwort bestätigen",
    createPassport:   "Pass erstellen",
    editPassport:     "Pass bearbeiten",
    deletePassport:   "Löschen",
    releasePassport:  "Freigeben",
    revisePassport:   "Überarbeiten",
    viewPassport:     "Anzeigen",
    draft:            "Entwurf",
    released:         "Freigegeben",
    revised:          "In Überarbeitung",
    inReview:         "In Prüfung",
    inApproval:       "In Genehmigung",
    passportType:     "Passtyp",
    modelName:        "Modellname",
    productId:        "Produkt-ID",
    version:          "Version",
    status:           "Status",
    createdBy:        "Erstellt von",
    date:             "Datum",
    completeness:     "Vollständigkeit",
    firstName:        "Vorname",
    lastName:         "Nachname",
    email:            "E-Mail",
    phone:            "Telefon",
    jobTitle:         "Berufsbezeichnung",
    bio:              "Biografie",
    profilePhoto:     "Profilfoto",
    changePassword:   "Passwort ändern",
    saveChanges:      "Änderungen speichern",
    notifications:    "Benachrichtigungen",
    markAllRead:      "Alle als gelesen markieren",
    noNotifications:  "Keine neuen Benachrichtigungen",
    submitForReview:  "Zur Prüfung einreichen",
    approvePassport:  "Genehmigen",
    rejectPassport:   "Ablehnen",
    reviewer:         "Prüfer",
    approver:         "Genehmiger",
    addComment:       "Kommentar hinzufügen",
    myBacklog:        "Meine Warteschlange",
    inProgress:       "In Bearbeitung",
    save:             "Speichern",
    cancel:           "Abbrechen",
    delete:           "Löschen",
    search:           "Suchen",
    loading:          "Laden…",
    error:            "Fehler",
    success:          "Erfolg",
    back:             "Zurück",
    yes:              "Ja",
    no:               "Nein",
    optional:         "optional",
    viewFullPassport: "Vollständigen Pass anzeigen",
    verifiedProduct:  "Verifiziertes Produkt",
    scanAgain:        "Erneut scannen",
    learnMore:        "Mehr erfahren",
    certifications:   "Zertifizierungen",
    sustainability:   "Nachhaltigkeit",
    materials:        "Materialien",
    safety:           "Sicherheit",
    carbonFootprint:  "CO₂-Fußabdruck",
    recycled:         "Recycelter Anteil",
    theme:            "Design",
    colorScheme:      "Farbschema",
    language:         "Sprache",
    totalPassports:   "Pässe gesamt",
    draftCount:       "Entwürfe",
    releasedCount:    "Freigegeben",
    revisedCount:     "In Überarbeitung",
    completenessAvg:  "Ø Vollständigkeit",
    thisMonth:        "Diesen Monat",
    allTime:          "Gesamt",
    totalScans:       "Scans insgesamt",
    recentActivity:   "Letzte Aktivitäten",
    introduction:     "Einleitung",
  },
};

// ── Context ──────────────────────────────────────────────────
const I18nContext = createContext({ t: (k) => k, lang: "en", setLang: () => {} });

const normalizeTranslationKey = (value) => String(value || "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase())
  .replace(/[^a-zA-Z0-9]/g, "")
  .replace(/^[A-Z]/, chr => chr.toLowerCase());

export const translateText = (lang, key) =>
  (translations[lang] && translations[lang][key]) ||
  (translations.en && translations.en[key]) ||
  key;

export const translateSchemaLabel = (lang, source, explicitKey) => {
  const candidates = [
    source?.translations?.[lang],
    source?.translations?.en,
    source?.label_i18n?.[lang],
    source?.label_i18n?.en,
    source?.title_i18n?.[lang],
    source?.title_i18n?.en,
    explicitKey,
    source?.i18nKey,
    source?.translationKey,
    source?.key,
    normalizeTranslationKey(source?.label),
    normalizeTranslationKey(source?.title),
    source?.label,
    source?.title,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const translated = translateText(lang, candidate);
    if (translated !== candidate) return translated;
  }

  return source?.label || source?.title || explicitKey || "";
};

export const translateFieldValue = (lang, value, type) => {
  if (type === "boolean") return value ? translateText(lang, "yes") : translateText(lang, "no");
  return value;
};

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(
    () => localStorage.getItem("dpp_lang") || "en"
  );

  const setLang = (l) => {
    localStorage.setItem("dpp_lang", l);
    setLangState(l);
  };

  const t = (key) => translateText(lang, key);

  return (
    <I18nContext.Provider value={{ t, lang, setLang }}>
      {children}
    </I18nContext.Provider>
  );
}

export const useI18n = () => useContext(I18nContext);

export const LANGUAGES = [
  { code: "en", name: "English",  flag: "🇬🇧" },
  { code: "sv", name: "Svenska",  flag: "🇸🇪" },
  { code: "de", name: "Deutsch",  flag: "🇩🇪" },
];
