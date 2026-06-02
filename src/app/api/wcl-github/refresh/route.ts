import { getWclGithubEnv } from "@/lib/wcl-github/env";
import { refreshAndWriteWclGithubSnapshots } from "@/lib/wcl-github/collector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const env = getWclGithubEnv();
    const providedSecret = request.headers.get("x-refresh-secret") || new URL(request.url).searchParams.get("secret");

    if (!providedSecret || providedSecret !== env.refreshSecret) {
      return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const result = await refreshAndWriteWclGithubSnapshots();
    return Response.json(result);
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
