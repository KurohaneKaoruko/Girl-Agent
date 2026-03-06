import type { ApiError } from "@/types";

export function describeApiError(error: ApiError) {
  switch (error.code) {
    case "STREAM_ABORTED":
      return { title: "已停止生成", message: error.message };
    case "UNAUTHORIZED":
      return { title: "需要登录", message: error.message };
    case "FORBIDDEN":
      return { title: "无权限访问", message: error.message };
    case "NOT_FOUND":
      return { title: "接口不存在", message: error.message };
    case "BAD_REQUEST":
    case "VALIDATION_ERROR":
      return { title: "提交失败", message: error.message };
    case "CONFLICT":
      return { title: "状态冲突", message: error.message };
    case "SERVER_ERROR":
    case "INTERNAL_ERROR":
      return { title: "服务异常", message: error.message };
    default:
      return { title: "操作失败", message: error.message };
  }
}
