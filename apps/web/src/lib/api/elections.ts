import type {
  BallotBoxStatus, ElectionListItem, ElectionLiveSummary, ElectionOut, ElectionStatus, VoteEventKind, VoteEventOut,
} from "../types";
import { BASE, get, post, csrfHeaders, silentRefresh, errorMessageFromResponse, ApiError, pathSegment } from "./core";

export const electionsApi = {
  list: () => get<ElectionListItem[]>("/elections"),
  get: (id: string) => get<ElectionOut>(`/elections/${pathSegment(id)}`),
  create: (body: {
    title: string;
    description?: string;
    is_public?: boolean;
    seats?: number;
    eligible_voter_count?: number | null;
    turnout_threshold_pct?: number | null;
    vote_threshold_pct?: number | null;
    candidates: {
      name: string;
      number: number;
      color: string;
      sort_order?: number;
      members?: { position: string; name: string; photo_url?: string | null; sort_order?: number }[];
    }[];
    ballot_boxes: {
      name: string;
      expected_total_votes?: number | null;
      sort_order?: number;
    }[];
  }) => post<ElectionOut>("/elections", body),
  uploadImage: async (file: File): Promise<{ url: string }> => {
    const fd = new FormData();
    fd.append("file", file);
    const doFetch = () =>
      fetch(`${BASE}/elections/images`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders("POST"),
        body: fd,
      });
    let res = await doFetch();
    if (res.status === 401) {
      const ok = await silentRefresh();
      if (ok) res = await doFetch();
    }
    if (!res.ok) throw new ApiError(res.status, await errorMessageFromResponse(res));
    return res.json();
  },
  updateStatus: (id: string, status: ElectionStatus) =>
    post<ElectionOut>(`/elections/${pathSegment(id)}/status`, { status }),
  updateBallotBoxStatus: (id: string, boxId: string, status: BallotBoxStatus) =>
    post(`/elections/${pathSegment(id)}/ballot-boxes/${boxId}/status`, { status }),
  addEvent: (
    id: string,
    body: {
      ballot_box_id: string;
      candidate_id?: string | null;
      kind: VoteEventKind;
      delta: number;
      reason?: string;
    },
  ) => post<VoteEventOut>(`/elections/${pathSegment(id)}/events`, body),
  reverseEvent: (id: string, eventId: string) =>
    post<VoteEventOut>(`/elections/${pathSegment(id)}/events/${eventId}/reverse`),
  events: (id: string, limit = 100) =>
    get<VoteEventOut[]>(`/elections/${pathSegment(id)}/events?limit=${limit}`),
  live: (id: string) =>
    get<ElectionLiveSummary>(`/elections/public/${pathSegment(id)}/live`),
};
