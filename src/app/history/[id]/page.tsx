import { LocalHistoryView } from "./LocalHistoryView";
export const dynamicParams = true;
export function generateStaticParams() { return []; }
export default function HistoryPage() { return <LocalHistoryView />; }
