type DirectoryLink = {
  label: string;
  href: string;
  isMore?: boolean;
};

type DirectoryColumn = {
  index: string;
  title: string;
  href: string;
  links: DirectoryLink[];
  note?: string;
};

const CAREER_URL =
  "https://wenmsg.notion.site/3a1f211130e48082bf84ec966fa08140";
const WORK_URL =
  "https://wenmsg.notion.site/2c8f211130e480698093c9f3e459cf19";
const JOURNAL_URL =
  "https://wenmsg.notion.site/3a1f211130e480b0b3e1c8c30b902517";

// 底部目录只使用公开 Notion 页面，确保每个条目都能跳转到真实内容。
const directoryColumns: DirectoryColumn[] = [
  {
    index: "01",
    title: "职业经历",
    href: CAREER_URL,
    links: [
      {
        label: "QTrade",
        href: "https://wenmsg.notion.site/QTrade-3a1f211130e4800d8a5bc3fb3ffeaaf2?pvs=25",
      },
      {
        label: "Kingdee",
        href: "https://wenmsg.notion.site/Kingdee-3a1f211130e480608e16f7a50c77c42b?pvs=25",
      },
      {
        label: "CoolBox",
        href: "https://wenmsg.notion.site/CoolBox-3a1f211130e48038a132d55dbbfcc6e3?pvs=25",
      },
      { label: "更多", href: CAREER_URL, isMore: true },
    ],
  },
  {
    index: "02",
    title: "个人作品",
    href: WORK_URL,
    links: [
      {
        label: "客户端开发的尝试",
        href: "https://wenmsg.notion.site/1c0f211130e480218e58e66af61f09e2?pvs=25",
      },
      {
        label: "Petly Care",
        href: "https://wenmsg.notion.site/Petly-Care-2c8f211130e480918bdfec198e501273?pvs=25",
      },
      {
        label: "retimeber 计时器",
        href: "https://wenmsg.notion.site/retimeber-1aff211130e4808d9511f5cddb8d8a30?pvs=25",
      },
      {
        label: "IDPhotoMaker",
        href: "https://wenmsg.notion.site/IDPhotoMaker-IOS-APP-133f211130e4808d9df7ecb870a4ca84?pvs=25",
      },
      { label: "更多", href: WORK_URL, isMore: true },
    ],
  },
  {
    index: "03",
    title: "流水账",
    href: JOURNAL_URL,
    note: "偶尔记录生活、想法和正在发生的事。",
    links: [{ label: "打开流水账", href: JOURNAL_URL }],
  },
];

// 单列目录统一处理标题、说明与外链，保持三列结构和交互一致。
const DirectoryColumn = ({ column }: { column: DirectoryColumn }) => (
  <section className="directory-column" aria-labelledby={`column-${column.index}`}>
    <div className="column-heading">
      <span className="column-index" aria-hidden="true">
        {column.index}
      </span>
      <h2 id={`column-${column.index}`}>
        <a href={column.href} target="_blank" rel="noreferrer">
          {column.title}
        </a>
      </h2>
    </div>

    {column.note ? <p className="column-note">{column.note}</p> : null}

    <ul className="directory-links">
      {column.links.map((link) => (
        <li key={`${column.index}-${link.label}`}>
          <a
            className={link.isMore ? "more-link" : undefined}
            href={link.href}
            target="_blank"
            rel="noreferrer"
          >
            {link.label}
          </a>
        </li>
      ))}
    </ul>
  </section>
);

// 首页用一个大字首屏表达身份，并把全部内容入口集中到底部目录。
const Home = () => (
  <main className="site-shell">
    <section className="hero" aria-labelledby="hero-title">
      <p className="hero-kicker">Wenren / Software Engineer</p>

      <h1 id="hero-title">
        Wenren 在做
        <a href={WORK_URL} target="_blank" rel="noreferrer">
          独立产品
        </a>
        。
      </h1>

      <div className="hero-meta" aria-label="个人简介">
        <p>软件工程师，正在成为独立开发者。</p>
        <p>写代码，做产品，也记录日常。</p>
      </div>
    </section>

    <footer className="directory" aria-label="内容目录">
      {directoryColumns.map((column) => (
        <DirectoryColumn key={column.index} column={column} />
      ))}
    </footer>
  </main>
);

export default Home;
