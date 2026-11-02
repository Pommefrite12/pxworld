/** Longest comment, in characters (the database enforces the same limit). */
export const COMMENT_MAX = 500;

/** What the API returns for one comment. */
export interface CommentView {
  id: string;
  body: string;
  createdAt: string;
  author: { username: string; avatarId: string | null };
  /** The viewer may remove it: its author, the owner of the parcel, or staff. */
  canRemove: boolean;
}
