export function PagePlaceholder({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase: string;
}) {
  return (
    <div className="mx-auto max-w-2xl rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center">
      <h1 className="text-xl font-semibold text-neutral-900">{title}</h1>
      <p className="mt-2 text-sm text-neutral-500">{description}</p>
      <p className="mt-4 inline-block rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-500">
        {phase}
      </p>
    </div>
  );
}