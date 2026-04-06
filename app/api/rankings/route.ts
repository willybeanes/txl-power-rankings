import { NextResponse } from "next/server";
import { fetchESPNData } from "@/lib/espn";
import { scoreTeams } from "@/lib/data";

export async function GET() {
  try {
    const teams = await fetchESPNData();
    const rankings = scoreTeams(teams);
    return NextResponse.json({ rankings, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("ESPN fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch ESPN data" },
      { status: 500 }
    );
  }
}
