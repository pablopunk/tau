import { Navigate, useLocation } from "react-router";

/** `/m/<id>/...` (the 0.1.x node URL) goes to `/n/<id>/...` with the same id, keeping search and hash. */
export function LegacyNodeRedirect() {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={`/n${pathname.slice("/m".length)}${search}${hash}`} replace />;
}
