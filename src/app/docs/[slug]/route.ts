import { DOCS_PAGES } from "@/lib/agent-static-assets";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const content = DOCS_PAGES[slug];
  if (!content) {
    return new Response("Document not found. See /llms.txt for available pages.\n", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  return new Response(content, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      Vary: "Accept",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
