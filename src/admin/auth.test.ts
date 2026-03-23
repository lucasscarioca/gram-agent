import { beforeEach, describe, expect, it, vi } from "vitest";

const joseMock = vi.hoisted(() => ({
  createRemoteJWKSet: vi.fn(),
  jwtVerify: vi.fn(),
}));

vi.mock("jose", () => ({
  createRemoteJWKSet: joseMock.createRemoteJWKSet,
  jwtVerify: joseMock.jwtVerify,
}));

import { verifyAccessJwt } from "./auth";

describe("verifyAccessJwt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("verifies the token against the Access issuer and audience", async () => {
    const jwks = Symbol("jwks");
    joseMock.createRemoteJWKSet.mockReturnValue(jwks);
    joseMock.jwtVerify.mockResolvedValue({ payload: { email: "admin@example.com" } });

    await expect(
      verifyAccessJwt({
        token: "token-1",
        teamDomain: "https://team.cloudflareaccess.com/",
        audience: "aud-1",
      }),
    ).resolves.toEqual({ email: "admin@example.com" });

    expect(joseMock.createRemoteJWKSet).toHaveBeenCalledWith(new URL("https://team.cloudflareaccess.com/cdn-cgi/access/certs"));
    expect(joseMock.jwtVerify).toHaveBeenCalledWith("token-1", jwks, {
      issuer: "https://team.cloudflareaccess.com",
      audience: "aud-1",
    });
  });

  it("reuses the cached JWKS per team domain", async () => {
    const jwks = Symbol("jwks");
    joseMock.createRemoteJWKSet.mockReturnValue(jwks);
    joseMock.jwtVerify.mockResolvedValue({ payload: {} });
    const teamDomain = "https://team-two.cloudflareaccess.com";

    await verifyAccessJwt({
      token: "token-1",
      teamDomain,
      audience: "aud-1",
    });
    await verifyAccessJwt({
      token: "token-2",
      teamDomain: `${teamDomain}/`,
      audience: "aud-1",
    });

    expect(joseMock.createRemoteJWKSet).toHaveBeenCalledTimes(1);
    expect(joseMock.jwtVerify).toHaveBeenCalledTimes(2);
  });
});
