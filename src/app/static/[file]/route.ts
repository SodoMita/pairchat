import {
  CLIENT_PY_SOURCE,
  CREATE_PY_SOURCE,
  getClientMjsSource,
  getCreateMjsSource,
} from "@/lib/agent-static-assets";

export async function GET(
  _request: Request,
  context: { params: Promise<{ file: string }> },
) {
  const { file } = await context.params;
  let body: string | null = null;
  if (file === "create.mjs") body = getCreateMjsSource();
  else if (file === "client.mjs") body = getClientMjsSource();
  else if (file === "create.py") body = CREATE_PY_SOURCE;
  else if (file === "client.py") body = CLIENT_PY_SOURCE;

  if (!body) {
    return new Response("Unknown client file. Available: create.mjs, client.mjs, create.py, client.py\n", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
