declare module "tree-kill" {
  type Callback = (error?: Error) => void;

  export default function treeKill(
    pid: number,
    signal?: string,
    callback?: Callback,
  ): void;
}
