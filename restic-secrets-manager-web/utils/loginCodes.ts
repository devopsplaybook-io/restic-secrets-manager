import {
  createLoginCodeService,
  type LoginCodeService,
} from "@devopsplaybook.io/common-web/services/LoginCodeService";

/** Bearer of the signed-in user: only preview/approve send it. */
export function getLoginCodeAuthHeader(): Record<string, string> | undefined {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

/**
 * Persist the redeemed session through the same path as the password login:
 * store the token and load the normalized session from its JWT claims.
 */
export async function persistLoginCodeSession(
  token: string,
  user: unknown,
): Promise<void> {
  useAuthStore().setSession(
    token,
    (user ?? null) as Record<string, unknown> | null,
  );
}

/**
 * The shared UsersRoutes only mounts the routes when enabled; treat any
 * failure (404 when disabled, network) as "no login-code UI".
 */
export async function probeLoginCodeAvailability(
  service: LoginCodeService,
): Promise<boolean> {
  try {
    const capabilities = await service.capabilities();
    return capabilities.enabled === true && capabilities.available === true;
  } catch {
    return false;
  }
}

let loginCodeService: LoginCodeService | null = null;

export function getLoginCodeService(): LoginCodeService {
  if (!loginCodeService) {
    loginCodeService = createLoginCodeService({
      baseUrl: "/api/users/login-codes",
      getAuthHeader: getLoginCodeAuthHeader,
      onSession: persistLoginCodeSession,
    });
  }
  return loginCodeService;
}
