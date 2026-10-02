import { AuthWiringSetOTel } from "./AuthWiring";

jest.mock("@devopsplaybook.io/common-utils", () => {
  const actual = jest.requireActual("@devopsplaybook.io/common-utils");
  return {
    ...actual,
    AuthSetOTel: jest.fn(),
    UsersDataSetOTel: jest.fn(),
    UsersApiTokensDataSetOTel: jest.fn(),
  };
});

const commonUtils = jest.requireMock("@devopsplaybook.io/common-utils");

describe("AuthWiringSetOTel", () => {
  it("should register the OTel tracer of every auth/users module", () => {
    const tracer = { startSpan: jest.fn() };
    AuthWiringSetOTel(tracer as any);
    expect(commonUtils.AuthSetOTel).toHaveBeenCalledWith(tracer);
    expect(commonUtils.UsersDataSetOTel).toHaveBeenCalledWith(tracer);
    // Dropping this registration breaks expired/malformed token handling (500)
    expect(commonUtils.UsersApiTokensDataSetOTel).toHaveBeenCalledWith(tracer);
  });
});
