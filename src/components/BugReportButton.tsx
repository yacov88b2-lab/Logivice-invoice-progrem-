import { useState } from 'react';
import { api } from '../api';

export function BugReportButton() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', severity: 'medium', reported_by: '' });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentPage = window.location.pathname + window.location.hash;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.description.trim()) {
      setError('Title and description are required.');
      return;
    }
    try {
      setLoading(true);
      setError(null);
      await api.reportBug({
        title: form.title,
        description: form.description,
        severity: form.severity,
        reported_by: form.reported_by || undefined,
        page: currentPage,
      });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit report.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setSubmitted(false);
    setForm({ title: '', description: '', severity: 'medium', reported_by: '' });
    setError(null);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Report a bug"
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-xs font-semibold text-white shadow-lg hover:bg-red-700 transition-colors"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
        </svg>
        Report Bug
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-950">Report a Bug</h2>
              <button onClick={handleClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">&times;</button>
            </div>

            {submitted ? (
              <div className="px-5 py-8 text-center">
                <div className="text-2xl mb-2">Thanks!</div>
                <p className="text-sm text-slate-600">Your report has been logged and will be reviewed.</p>
                <button
                  onClick={handleClose}
                  className="mt-5 rounded bg-[#28258b] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1f1d70]"
                >
                  Close
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="Short summary of the issue"
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none focus:ring-2 focus:ring-[#28258b]/20"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Description *</label>
                  <textarea
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="What happened? What did you expect?"
                    rows={4}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none focus:ring-2 focus:ring-[#28258b]/20"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Severity</label>
                    <select
                      value={form.severity}
                      onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}
                      className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Your name</label>
                    <input
                      type="text"
                      value={form.reported_by}
                      onChange={e => setForm(f => ({ ...f, reported_by: e.target.value }))}
                      placeholder="Optional"
                      className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#28258b] focus:outline-none"
                    />
                  </div>
                </div>

                <p className="text-xs text-slate-400">Page: {currentPage}</p>

                {error && (
                  <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
                )}

                <div className="flex gap-3 pt-1">
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {loading ? 'Submitting...' : 'Submit Report'}
                  </button>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
