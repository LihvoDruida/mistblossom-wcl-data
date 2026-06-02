import { readMemberSnapshotBySlug } from "@/lib/wcl-github/readStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const snapshot = await readMemberSnapshotBySlug(slug);

    if (!snapshot) {
      return Response.json({ ok: false, error: "WCL member snapshot not found" }, { status: 404 });
    }

    return Response.json({ ok: true, data: snapshot });
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
