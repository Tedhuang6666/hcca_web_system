import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { passkeysApi } from "@/lib/api";

export async function registerPasskey(name?: string) {
  const options = await passkeysApi.registrationOptions();
  const credential = await startRegistration({ optionsJSON: options as never });
  return passkeysApi.verifyRegistration(credential, name);
}

export async function loginWithPasskey(email: string) {
  const options = await passkeysApi.authenticationOptions(email);
  const credential = await startAuthentication({ optionsJSON: options as never });
  return passkeysApi.verifyAuthentication(credential);
}
