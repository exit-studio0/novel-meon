import Workbench from "@/components/workbench/workbench";
import { getUserSettingsWithReason } from '@/services/settings';

export default async function Page() {
  const { settings, reason, detail } = await getUserSettingsWithReason();

  if (!settings) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-start justify-center gap-4 px-6 py-12">
        <h1 className="text-2xl font-semibold">无法进入 Novel Meon</h1>
        <p className="text-sm text-muted-foreground">
          {reason ?? '鉴权未通过'}
        </p>
        {detail ? (
          <pre className="w-full overflow-x-auto rounded-md border bg-muted p-3 text-xs text-muted-foreground">
            {detail}
          </pre>
        ) : null}
        <p className="text-sm text-muted-foreground">
          建议先在主站完成登录，再返回当前页面重试。
        </p>
        <div className="flex gap-3">
          <a
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            href="https://meonai.art"
          >
            前往主站登录
          </a>
          <a
            className="rounded-md border px-4 py-2 text-sm font-medium"
            href="https://novel.meonai.art"
          >
            重试进入 Novel
          </a>
        </div>
      </main>
    );
  }

  return <Workbench user={settings} />;
}
