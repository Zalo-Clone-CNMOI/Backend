import type {
  ApiInternals,
  IceServersResponse,
  CallHistoryResponse,
  ListPollsQueryPayload,
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

export async function createPollViaApi(
  { axios, basePath }: ApiInternals,
  accessToken: string,
  opts: { conversationId: string; dto: unknown },
): Promise<unknown> {
  const response = await axios.post(
    `${basePath}/conversations/${opts.conversationId}/polls`,
    opts.dto,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  return response.data;
}

export async function listPollsViaApi(
  { axios, basePath }: ApiInternals,
  accessToken: string,
  opts: { conversationId: string; query?: ListPollsQueryPayload },
): Promise<unknown> {
  const response = await axios.get(
    `${basePath}/conversations/${opts.conversationId}/polls`,
    { params: opts.query, headers: { Authorization: `Bearer ${accessToken}` } },
  );
  return response.data;
}

export async function editPollViaApi(
  { axios, basePath }: ApiInternals,
  accessToken: string,
  opts: { conversationId: string; pollId: string; dto: unknown },
): Promise<unknown> {
  const response = await axios.patch(
    `${basePath}/conversations/${opts.conversationId}/polls/${opts.pollId}`,
    opts.dto,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  return response.data;
}

export async function castPollVoteViaApi(
  { axios, basePath }: ApiInternals,
  accessToken: string,
  opts: { conversationId: string; pollId: string; optionIds: string[] },
): Promise<unknown> {
  const response = await axios.post(
    `${basePath}/conversations/${opts.conversationId}/polls/${opts.pollId}/vote`,
    { option_ids: opts.optionIds },
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  return response.data;
}

export async function addPollOptionViaApi(
  { axios, basePath }: ApiInternals,
  accessToken: string,
  opts: { conversationId: string; pollId: string; label: string },
): Promise<unknown> {
  const response = await axios.post(
    `${basePath}/conversations/${opts.conversationId}/polls/${opts.pollId}/options`,
    { label: opts.label },
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  return response.data;
}

export async function removePollOptionViaApi(
  { axios, basePath }: ApiInternals,
  accessToken: string,
  opts: { conversationId: string; pollId: string; optionId: string },
): Promise<unknown> {
  const response = await axios.delete(
    `${basePath}/conversations/${opts.conversationId}/polls/${opts.pollId}/options/${opts.optionId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  return response.data;
}
