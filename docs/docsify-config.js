window.$docsify = {
  name: "ecsy",
  loadSidebar: true,
  auto2top: true,
  homepage: "./README.md",
  basePath: "/docs/",
  relativePath: true,
  search: {
    paths: "auto",
    depth: 3
  },
  plugins: [window.docsifyTocBackPlugin]
};
