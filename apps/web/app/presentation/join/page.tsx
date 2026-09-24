import { redirect } from "next/navigation";

export default async function PresentationJoinPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const value = (await searchParams).code;
  const rawCode = Array.isArray(value) ? value[0] : value;
  const code = (rawCode ?? "").replace(/\D/g, "").slice(0, 7);
  redirect(code ? `/join?${new URLSearchParams({ code })}` : "/join");
}
