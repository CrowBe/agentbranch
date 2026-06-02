import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Next 16's proxy convention (formerly middleware). Clerk only engages when
// keys are configured; otherwise it would throw on every request. Until then,
// pass through so the shell runs offline.
const clerkEnabled = Boolean(process.env.CLERK_SECRET_KEY);

export default clerkEnabled
  ? clerkMiddleware()
  : function passthrough(_request: NextRequest) {
      return NextResponse.next();
    };

export const config = {
  matcher: [
    // Skip Next internals and static files; run on everything else + API.
    "/((?!_next|.*\\..*).*)",
    "/(api|trpc)(.*)",
  ],
};
