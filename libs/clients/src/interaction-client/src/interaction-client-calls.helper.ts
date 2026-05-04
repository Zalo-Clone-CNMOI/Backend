import type {
  ApiInternals,
  IceServersResponse,
  CallHistoryResponse,
} from './interaction-client.types';

export async function getIceServersViaApi(
  { axios, basePath }: ApiInternals,
  accessToken: string,
): Promise<IceServersResponse> {
  const response = await axios.get<IceServersResponse>(
    `${basePath}/calls/ice-servers`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  return response.data;
}

export async function getCallHistoryViaApi(
  { axios, basePath }: ApiInternals,
  accessToken: string,
  opts: { conversationId: string; page?: number; limit?: number },
): Promise<CallHistoryResponse> {
  const response = await axios.get<CallHistoryResponse>(
    `${basePath}/conversations/${opts.conversationId}/calls`,
    {
      params: { page: opts.page, limit: opts.limit },
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  return response.data;
}

export async function closePollViaApi(
  { axios, basePath }: ApiInternals,
  accessToken: string,
  opts: { conversationId: string; pollId: string },
): Promise<unknown> {
  const response = await axios.post(
    `${basePath}/conversations/${opts.conversationId}/polls/${opts.pollId}/close`,
    undefined,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  return response.data;
}

export async function retractPollVoteViaApi(
  { axios, basePath }: ApiInternals,
  accessToken: string,
  opts: { conversationId: string; pollId: string },
): Promise<unknown> {
  const response = await axios.delete(
    `${basePath}/conversations/${opts.conversationId}/polls/${opts.pollId}/vote`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  return response.data;
}

export async function getPollDetailViaApi(
  { axios, basePath }: ApiInternals,
  accessToken: string,
  opts: { conversationId: string; pollId: string },
): Promise<unknown> {
  const response = await axios.get(
    `${basePath}/conversations/${opts.conversationId}/polls/${opts.pollId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  return response.data;
}
