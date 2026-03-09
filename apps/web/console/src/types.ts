export * from "@/generated/appTypes";

export type ApiError = {
  code: string;
  message: string;
  details?: unknown;
};
