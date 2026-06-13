export function buildSignupProfile(formData) {
  const profile = {
    id: crypto.randomUUID(),
    name: String(formData.get("signupName") || "").trim(),
    email: String(formData.get("signupEmail") || "").trim(),
    password: String(formData.get("signupPassword") || ""),
    phone: "",
    role: String(formData.get("signupRole") || "player"),
    campaignIds: formData.getAll("signupCampaigns")
  };

  validateProfile(profile);
  return profile;
}

export function buildLoginCredentials(formData) {
  const credentials = {
    name: String(formData.get("loginName") || "").trim(),
    email: String(formData.get("loginName") || "").trim(),
    password: String(formData.get("loginPassword") || "")
  };

  if (!credentials.name) throw new Error("Escribe tu email para entrar.");
  if (!credentials.email.includes("@")) throw new Error("El login necesita un email.");
  if (!credentials.password) throw new Error("Escribe tu contrasena.");
  return credentials;
}

export function normalizePhone(phone) {
  return phone.replace(/[^\d+]/g, "");
}

function validateProfile(profile) {
  if (!profile.name) throw new Error("El signup necesita nombre.");
  if (!profile.email || !profile.email.includes("@")) throw new Error("Escribe un email valido.");
  if (profile.password.length < 4) throw new Error("La contrasena debe tener al menos 4 caracteres.");
  if (!["dm", "player"].includes(profile.role)) throw new Error("El rol debe ser DM o player.");
  if (profile.role === "player" && !profile.campaignIds.length) throw new Error("Elige al menos una campana.");
}
