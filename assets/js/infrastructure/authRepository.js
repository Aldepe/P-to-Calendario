const AUTH_KEY = "mesa-jackpot-auth-v1";
const DEMO_ACCOUNTS = [
  {
    id: "local-demo-dm",
    name: "DemoDM",
    email: "dm@example.local",
    role: "dm",
    phone: "",
    campaignIds: ["drakkenheim", "strahd", "eberron"],
    password: "demo123"
  },
  {
    id: "local-demo-player",
    name: "DemoPlayer",
    email: "player@example.local",
    role: "player",
    phone: "",
    campaignIds: ["drakkenheim", "strahd", "eberron"],
    password: "demo123"
  }
];

export class LocalAuthRepository {
  async currentUser() {
    const state = await readAuthState();
    const account = state.accounts.find((item) => item.id === state.sessionUserId);
    return account ? publicAccount(account) : null;
  }

  async signUp(profile) {
    const state = await readAuthState();
    const exists = state.accounts.some((account) => account.name.toLowerCase() === profile.name.toLowerCase());
    if (exists) throw new Error("Ya existe una cuenta con ese nombre.");

    const account = {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      role: profile.role,
      phone: profile.phone,
      campaignIds: profile.campaignIds,
      credentialHash: await hashCredential(profile.name, profile.password)
    };

    state.accounts.push(account);
    state.sessionUserId = account.id;
    writeAuthState(state);
    return publicAccount(account);
  }

  async login(credentials) {
    const state = await readAuthState();
    const account = state.accounts.find((item) => item.name.toLowerCase() === credentials.name.toLowerCase());
    if (!account) throw new Error("No encuentro esa cuenta.");

    const credentialHash = await hashCredential(account.name, credentials.password);
    if (credentialHash !== account.credentialHash) throw new Error("Contrasena incorrecta.");

    state.sessionUserId = account.id;
    writeAuthState(state);
    return publicAccount(account);
  }

  async logout() {
    const state = await readAuthState();
    state.sessionUserId = null;
    writeAuthState(state);
  }
}

export class SupabaseAuthRepository {
  constructor(client, fallback) {
    this.client = client;
    this.fallback = fallback;
  }

  async currentUser() {
    try {
      const { data } = await this.client.auth.getUser();
      if (!data?.user) return this.fallback.currentUser();
      return userFromSupabase(data.user);
    } catch (error) {
      console.warn("Auth remoto no disponible, usando auth local.", error);
      return this.fallback.currentUser();
    }
  }

  async signUp(profile) {
    try {
      const { data, error } = await this.client.auth.signUp({
        email: profile.email,
        password: profile.password,
        options: {
          data: {
            name: profile.name,
            email: profile.email,
            role: profile.role,
            campaignIds: profile.campaignIds
          }
        }
      });
      if (error || !data?.user) throw error || new Error("Signup remoto incompleto.");
      return userFromSupabase(data.user);
    } catch (error) {
      console.warn("Signup remoto fallido, usando auth local.", error);
      return this.fallback.signUp(profile);
    }
  }

  async login(credentials) {
    try {
      if (!credentials.email.includes("@")) throw new Error("El login remoto necesita email; usando fallback local.");
      const { data, error } = await this.client.auth.signInWithPassword({
        email: credentials.email,
        password: credentials.password
      });
      if (error || !data?.user) throw error || new Error("Login remoto incompleto.");
      return userFromSupabase(data.user);
    } catch (error) {
      console.warn("Login remoto fallido, usando auth local.", error);
      return this.fallback.login(credentials);
    }
  }

  async logout() {
    try {
      await this.client.auth.signOut();
    } finally {
      await this.fallback.logout();
    }
  }
}

function userFromSupabase(user) {
  return {
    id: user.id,
    name: user.user_metadata?.name || user.email || "Usuario",
    email: user.email || "",
    role: user.user_metadata?.role || "player",
    phone: user.phone || "",
    campaignIds: user.user_metadata?.campaignIds || []
  };
}

async function readAuthState() {
  const raw = localStorage.getItem(AUTH_KEY);
  const state = raw ? JSON.parse(raw) : { accounts: [], sessionUserId: null };
  const normalized = {
    accounts: Array.isArray(state.accounts) ? state.accounts : [],
    sessionUserId: state.sessionUserId || null
  };
  let changed = false;

  for (const demo of DEMO_ACCOUNTS) {
    if (!normalized.accounts.some((account) => account.id === demo.id || account.name.toLowerCase() === demo.name.toLowerCase())) {
      normalized.accounts.push({
        id: demo.id,
        name: demo.name,
        email: demo.email,
        role: demo.role,
        phone: demo.phone,
        campaignIds: demo.campaignIds,
        credentialHash: await hashCredential(demo.name, demo.password)
      });
      changed = true;
    }
  }

  if (changed) writeAuthState(normalized);
  return normalized;
}

function writeAuthState(state) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(state));
}

function publicAccount(account) {
  return {
    id: account.id,
    name: account.name,
    email: account.email || "",
    role: account.role,
    phone: account.phone,
    campaignIds: account.campaignIds || []
  };
}

async function hashCredential(name, password) {
  const data = new TextEncoder().encode(`${name.toLowerCase()}::${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
