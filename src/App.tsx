import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowRight,
  BookOpen,
  ChartNoAxesCombined,
  GraduationCap,
  History,
  LayoutDashboard,
  LogOut,
  NotebookPen,
  Users,
  X,
} from "lucide-react";
import type { Classroom, ClassSession, Lesson, User } from "../shared/types";
import { api, post } from "./api";
import { Brand, Buddy, Badge } from "./components";
import { Teacher } from "./teacher";
import { Student } from "./student";
import { StudentPassword } from "./student-password";
export interface Bootstrap {
  classes: Classroom[];
  sessions: ClassSession[];
  lessons: Lesson[];
  demo: boolean;
  aiReady: boolean;
}
export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [boot, setBoot] = useState<Bootstrap | null>(null),
    [page, setPage] = useState("classroom"),
    [unsaved, setUnsaved] = useState(false);
  useEffect(() => {
    const listener = (e: Event) =>
      setUnsaved(Boolean((e as CustomEvent).detail));
    window.addEventListener("lesson-dirty", listener);
    return () => window.removeEventListener("lesson-dirty", listener);
  }, []);
  const notify = (message: string) => {
    setError(message);
    window.dispatchEvent(
      new CustomEvent("classroom-error", { detail: message }),
    );
  };
  const navigate = (next: string) => {
    if (unsaved) {
      setError("备课内容有未保存修改，请先保存或放弃修改。");
      return;
    }
    setPage(next);
  };
  const refresh = async () => {
    const data = await api<Bootstrap>("/bootstrap");
    setBoot(data);
  };
  useEffect(() => {
    api<{ user: User }>("/me")
      .then((x) => setUser(x.user))
      .catch(() => {})
      .finally(() => setReady(true));
    const expired = () => {
      setUser(null);
      setBoot(null);
    };
    window.addEventListener("auth-expired", expired);
    return () => window.removeEventListener("auth-expired", expired);
  }, []);
  useEffect(() => {
    if (!user) return;
    refresh().catch((e) => setError(e.message));
    const timer = setInterval(() => refresh().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, [user?.id]);
  if (!ready)
    return (
      <div className="app-loading">
        <Brand />
        <span>正在打开课堂…</span>
      </div>
    );
  if (!user)
    return (
      <Login
        onLogin={(u) => {
          setUser(u);
          setPage("classroom");
          setError("");
        }}
      />
    );
  const teacher = user.role === "teacher";
  const nav = teacher
    ? [
        { id: "classroom", label: "课堂总览", icon: LayoutDashboard },
        { id: "lessons", label: "课时备课", icon: NotebookPen },
        { id: "students", label: "班级成员", icon: Users },
        { id: "history", label: "学习记录", icon: ChartNoAxesCombined },
      ]
    : [
        { id: "classroom", label: "我的课堂", icon: BookOpen },
        { id: "history", label: "学习足迹", icon: History },
      ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-label">
          {teacher ? "教师工作空间" : "我的学习空间"}
        </div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "selected" : ""}
              onClick={() => navigate(n.id)}
            >
              <n.icon size={19} />
              {n.label}
              {page === n.id && <i />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="little-orbit">✦</div>
          <p>
            {teacher
              ? "给学生一点时间，\n让理解慢慢发生。"
              : "讲给别人听，\n也是讲给自己听。"}
          </p>
          <span>LEARN BY TEACHING</span>
        </div>
        <div className="profile">
          <div className="profile-avatar">{user.name.slice(-2)}</div>
          <div>
            <b>{user.name}</b>
            <small>{teacher ? "教师账号" : user.username}</small>
          </div>
          <button
            className="icon-button"
            aria-label="退出登录"
            onClick={async () => {
              if (unsaved) {
                setError("备课内容有未保存修改，请先保存或放弃修改。");
                return;
              }
              await post("/logout");
              setUser(null);
              setBoot(null);
            }}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            函数的概念、性质及应用<span>/</span>
            <b>{nav.find((n) => n.id === page)?.label}</b>
          </div>
          <div className="topbar-right">
            {boot?.demo && <Badge tone="amber">演示环境 · 不作真实评价</Badge>}
            {!teacher && (
              <StudentPassword key={user.id} username={user.username} />
            )}
            <span className="connection">
              <i />
              {teacher ? "课堂管理" : "以教促学"}
            </span>
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button
              className="icon-button"
              aria-label="关闭提示"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {boot ? (
          teacher ? (
            <Teacher
              boot={boot}
              refresh={refresh}
              page={page}
              setPage={navigate}
              notify={notify}
            />
          ) : (
            <Student
              boot={boot}
              page={page}
              setPage={navigate}
              notify={notify}
              user={user}
            />
          )
        ) : (
          <div className="app-loading">正在读取课堂资料…</div>
        )}
      </div>
    </div>
  );
}
function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [role, setRole] = useState<"student" | "teacher">("student"),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [demo, setDemo] = useState(false);
  useEffect(() => {
    api("/config")
      .then((x) => setDemo(x.demo))
      .catch(() => {});
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await post<{ user: User }>("/login", {
        username,
        password,
      });
      if (result.user.role !== role) {
        await post("/logout");
        throw Error(
          `该账号属于${result.user.role === "teacher" ? "教师" : "学生"}，请切换登录身份。`,
        );
      }
      onLogin(result.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <section className="login-story">
        <Brand />
        <div className="story-content">
          <div className="eyebrow">
            <span />
            数学 · 以教促学
          </div>
          <h1>
            把知识，
            <br />
            讲明白<span>。</span>
          </h1>
          <p>
            今天，换你来当老师。
            <br />
            在一次次讲解、思考与发现中，
            <br />
            让理解真正属于自己。
          </p>
          <div className="function-art">
            <svg viewBox="0 0 420 235" aria-hidden="true">
              <defs>
                <pattern
                  id="grid"
                  width="30"
                  height="30"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M 30 0 L 0 0 0 30"
                    fill="none"
                    stroke="#d6e5dc"
                    strokeWidth=".6"
                  />
                </pattern>
              </defs>
              <rect width="420" height="235" fill="url(#grid)" />
              <path
                d="M35 182H395M210 215V18"
                stroke="#8ea899"
                strokeWidth="1"
              />
              <path
                d="M75 38Q210 322 345 38"
                fill="none"
                stroke="#437e68"
                strokeWidth="3"
              />
              <circle cx="276" cy="126" r="6" fill="#d3aa66" />
              <text
                x="320"
                y="94"
                fill="#437e68"
                fontSize="20"
                fontStyle="italic"
              >
                f(x)
              </text>
            </svg>
            <div className="art-note">
              <Buddy />
              <span>
                小老师，
                <br />
                这一步可以再教教我吗？
              </span>
            </div>
          </div>
        </div>
        <footer>每一次分享，都是理解的生长。</footer>
      </section>
      <section className="login-form-side">
        <div className="login-box">
          <span className="login-label">欢迎来到知己课堂</span>
          <h2>开启今天的学习</h2>
          <p className="muted">与小知一起，把每一个“为什么”讲清楚。</p>
          <div className="role-switch" role="group" aria-label="登录身份">
            <button
              type="button"
              className={role === "student" ? "active" : ""}
              onClick={() => setRole("student")}
            >
              <GraduationCap size={18} />
              我是学生
            </button>
            <button
              type="button"
              className={role === "teacher" ? "active" : ""}
              onClick={() => setRole("teacher")}
            >
              <NotebookPen size={18} />
              我是教师
            </button>
          </div>
          <form onSubmit={submit}>
            <label>
              {role === "student" ? "学号" : "教师账号"}
              <input
                autoComplete="username"
                placeholder={
                  role === "student" ? "请输入你的学号" : "请输入教师账号"
                }
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </label>
            <label>
              密码
              <input
                type="password"
                autoComplete="current-password"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <button className="button primary login-submit" disabled={busy}>
              {busy ? "正在进入…" : "进入课堂"}
              <ArrowRight size={18} />
            </button>
          </form>
          <div className="login-help">
            {role === "student"
              ? "初始密码为学号后四位。忘记密码时，请联系任课教师重置。"
              : "使用管理员创建的教师账号登录。"}
          </div>
          {demo && (
            <div className="demo-box">
              <Badge tone="amber">本机演示</Badge>
              <p>
                学生：20260101 / 0101
                <br />
                教师：teacher / demo-teacher-2026
              </p>
              <small>演示反馈不代表真实模型评价。</small>
            </div>
          )}
        </div>
        <div className="login-footnote">函数的概念、性质及应用 · 第一册</div>
      </section>
    </div>
  );
}
