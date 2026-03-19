import { createRemoteJWKSet, jwtVerify } from "jose";

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export interface AdminIdentity {
  email: string | null;
}

export async function verifyAccessJwt(input: {
  token: string;
  teamDomain: string;
  audience: string;
}): Promise<AdminIdentity> {
  const issuer = input.teamDomain.replace(/\/$/, "");
  const jwks = getJwks(issuer);
  const { payload } = await jwtVerify(input.token, jwks, {
    issuer,
    audience: input.audience,
  });

  return {
    email: typeof payload.email === "string" ? payload.email : null,
  };
}

function getJwks(teamDomain: string) {
  const cached = jwksCache.get(teamDomain);

  if (cached) {
    return cached;
  }

  const created = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
  jwksCache.set(teamDomain, created);
  return created;
}
