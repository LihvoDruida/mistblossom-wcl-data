import { readGuildIndex } from "@/lib/wcl-github/readStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const index = await readGuildIndex();

    if (!index) {
      return Response.json({ ok: false, error: "WCL index not found" }, { status: 404 });
    }

    return Response.json({ ok: true, data: index });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
