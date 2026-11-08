import { NextRequest } from "next/server"
import { profile } from "@/lib/auth-server"

export async function GET(request: NextRequest) { return profile(request) }
export async function PUT(request: NextRequest) { return profile(request) }
