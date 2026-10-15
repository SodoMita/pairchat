import { HomeView } from "./_components/HomeView";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // The home page is a pure landing page — it doesn't need the DB at
  // all. The health check (`/api/health`) separately validates the DB.
  return <HomeView />;
}