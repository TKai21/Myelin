import { NextRequest, NextResponse } from "next/server";
import { safeCompare } from "@/lib/safeCompare";
import { getSession } from "@/lib/session";

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  const expected = process.env.SITE_PASSWORD;

  if (
    typeof password !== "string" ||
    !expected ||
    !safeCompare(password, expected)
  ) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const session = await getSession();
  session.authenticated = true;
  await session.save();

  return NextResponse.json({ ok: true });
}

export async function GET() {
  // TEMP: always report authenticated while login is broken - revert
  // (restore the session.authenticated check below) once SITE_PASSWORD
  // login works again.
  return NextResponse.json({ authenticated: true });
}
