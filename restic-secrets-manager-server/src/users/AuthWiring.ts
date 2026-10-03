import { StandardTracer } from "@devopsplaybook.io/otel-utils";
import {
  AuthSetOTel,
  UsersApiTokensDataSetOTel,
  UsersDataSetOTel,
} from "@devopsplaybook.io/common-utils";

/** Registers the OTel tracers of every common-utils auth/users module. */
export function AuthWiringSetOTel(tracer: StandardTracer): void {
  AuthSetOTel(tracer);
  UsersDataSetOTel(tracer);
  UsersApiTokensDataSetOTel(tracer);
}
