export interface HttpResponseData {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyJson: unknown;
}

export async function parseResponse(response: Response): Promise<HttpResponseData> {
  const body = await response.text();

  let bodyJson: unknown = undefined;
  try {
    bodyJson = JSON.parse(body);
  } catch {
    // Non-JSON body is not an error
  }

  return {
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers.entries()),
    body,
    bodyJson,
  };
}
