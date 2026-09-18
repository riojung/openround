export interface SignInEnvironment {
  configuredOrigin: string;
  configuredSignInUrl: string;
  currentOrigin: string;
  originMismatch: boolean;
}

export function resolveSignInEnvironment(
  configuredWebUrl: string,
  currentLocation: string,
): SignInEnvironment | null {
  try {
    const configured = new URL(configuredWebUrl);
    const current = new URL(currentLocation);
    if (!["http:", "https:"].includes(configured.protocol)) return null;

    const configuredSignIn = new URL("/signin", configured);
    configuredSignIn.search = current.search;

    return {
      configuredOrigin: configured.origin,
      configuredSignInUrl: configuredSignIn.href,
      currentOrigin: current.origin,
      originMismatch: configured.origin !== current.origin,
    };
  } catch {
    return null;
  }
}
