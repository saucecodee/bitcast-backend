import { Request } from "express";
import { AuthUser } from "../..";


export * from "./post";
export * from "./share";
export * from "./topic";
export * from "./user";
export * from "./vote";

export interface AuthRequest extends Request {
  user: AuthUser
}
