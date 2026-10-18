import { HomeView } from "./_components/HomeView";

// Fully static: no database, cookies, or request data at render time.
export default function HomePage() {
  return <HomeView />;
}
