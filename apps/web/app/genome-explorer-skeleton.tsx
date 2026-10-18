import { Skeleton } from "@crispr/ui/components/skeleton";
import { Card, CardFooter, CardHeader } from "@crispr/ui/components/card";
import styles from "./genome-explorer.module.css";

/** Holds the scene's dimensions while its module, WebGL or sequence loads. */
export function DnaSceneSkeleton() {
  return (
    <div
      className={styles.sceneSkeleton}
      role="status"
      aria-label="Loading DNA viewer"
    >
      <Skeleton className={styles.scenePlaceholder} aria-hidden="true" />
    </div>
  );
}

/** Mirrors the responsive explorer without presenting invented findings or controls. */
export function GenomeExplorerSkeleton() {
  return (
    <section
      className={styles.explorer}
      aria-label="Genome explorer"
      aria-busy="true"
    >
      <span className="sr-only" role="status">
        Loading genome analysis
      </span>
      <div className={styles.content} aria-hidden="true">
        <header className={styles.header}>
          <div className={styles.title}>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3 w-44 max-w-full" />
          </div>
        </header>
        <div className={styles.body}>
          <div className={styles.visualization}>
            <div className={styles.viewerControls}>
              <Skeleton className="size-11 shrink-0 rounded-xl" />
              <Skeleton className="h-8 w-full min-w-0 max-w-sm rounded-lg" />
            </div>
            <div className={styles.scene}>
              <Skeleton className={styles.scenePlaceholder} />
            </div>
            <div className={styles.footer}>
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className={styles.karyotypePlaceholder} />
          </div>
          <aside className={styles.inspector}>
            <Skeleton className="h-7 w-44" />
            <section className={styles.diseaseCards}>
              {[0, 1].map((index) => (
                <Card key={index} size="sm" className="rounded-[20px] pt-0">
                  <Skeleton className="aspect-[16/10] rounded-none" />
                  <CardHeader>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <Skeleton className="h-3 w-12" />
                      <Skeleton className="h-4 w-16 rounded-full" />
                    </div>
                    <Skeleton className="h-5 w-4/5" />
                    <Skeleton className="h-3 w-3/5" />
                  </CardHeader>
                  <CardFooter>
                    <Skeleton className="h-8 w-full rounded-lg" />
                  </CardFooter>
                </Card>
              ))}
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}
