import { CalendarApp } from "./application/calendarApp.js";
import { LocalAuthRepository, SupabaseAuthRepository } from "./infrastructure/authRepository.js";
import { ConsoleNotificationGateway, SupabaseNotificationGateway } from "./infrastructure/notificationGateway.js";
import { LocalStorageRepository, SupabaseRepository } from "./infrastructure/storageRepository.js";

async function createServices() {
  const fallbackRepository = new LocalStorageRepository();
  const fallbackAuth = new LocalAuthRepository();
  const fallbackNotifications = new ConsoleNotificationGateway();
  const config = window.DND_CALENDAR_CONFIG || {};

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    return {
      repository: fallbackRepository,
      authRepository: fallbackAuth,
      notificationGateway: fallbackNotifications
    };
  }

  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  const client = createClient(config.supabaseUrl, config.supabaseAnonKey);

  return {
    repository: new SupabaseRepository(client),
    authRepository: new SupabaseAuthRepository(client),
    notificationGateway: new SupabaseNotificationGateway(client)
  };
}

const services = await createServices();
const app = new CalendarApp(services);
app.init();
