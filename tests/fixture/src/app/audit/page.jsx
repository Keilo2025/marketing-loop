export const metadata = {
  title: 'Deployment audit',
  description: 'Run an audit across your deployment pipeline.',
};

const emptyState = 'No deployments found.';
const errorMessage = 'Something went wrong. Error code 500.';

export default function AuditPage() {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-16">
      <h1 className="text-4xl font-semibold">Your free deployment audit</h1>
      <p className="text-slate-600">
        We analyse your last 30 deployments and tell you what broke.
      </p>
      <button className="rounded bg-black px-5 py-2 text-white">Submit</button>
      <p className="text-sm text-slate-400">{emptyState}</p>
      <p className="text-sm text-red-500">{errorMessage}</p>
    </main>
  );
}
