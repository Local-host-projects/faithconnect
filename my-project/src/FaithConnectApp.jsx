/**
 * FaithConnect — all-in-one app file.
 *
 * Contains: API client, AuthContext, ProtectedRoute, LandingPage, LoginPage,
 * RegisterPage, PostCard, CreatePostForm, FeedPage, ChurchTimelinePage, and
 * the router. Import <App /> from your main.jsx and render it — that's the
 * only other file you need.
 *
 * npm install react-router-dom
 * Tailwind must already be set up (src/index.css with @tailwind directives).
 *
 * FONT: the landing/login/register pages use "Fraunces" for headlines.
 * Add this to your index.html <head> (or import it in src/index.css):
 *   <link rel="preconnect" href="https://fonts.googleapis.com">
 *   <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&display=swap" rel="stylesheet">
 * Without it, the browser falls back to the generic serif in the stack.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";

// =====================================================================
// 1. API CLIENT
// =====================================================================

const BASE_URL = "https://faith-connect-production.up.railway.app";
const TOKEN_KEY = "faithconnect_token";

/**
 * "urlencoded" matches the openapi.json spec for /auth/login
 * (Body_login_auth_login_post is application/x-www-form-urlencoded).
 * Flip to "multipart" only if your backend truly wants a FormData body —
 * a real FormData object makes the browser send multipart/form-data,
 * which most FastAPI OAuth2 login endpoints will reject with a 422.
 */
const LOGIN_BODY_MODE = "urlencoded";

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

class FaithConnectApi {
  constructor(baseUrl = BASE_URL) {
    this.baseUrl = baseUrl;
    /** Called on any 401 — AuthContext hooks into this to drop the session. */
    this.onUnauthorized = null;
  }

  getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  setToken(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* localStorage unavailable — ignore */
    }
  }

  isAuthenticated() {
    return Boolean(this.getToken());
  }

  logout() {
    this.setToken(null);
  }

  async request(path, options = {}) {
    const {
      method = "GET",
      body,
      isForm = false,
      isMultipart = false,
      headers = {},
      auth = true,
    } = options;

    const finalHeaders = { ...headers };
    let finalBody = body;

    if (body !== undefined && body !== null) {
      if (isMultipart) {
        finalBody = body; // FormData sets its own boundary
      } else if (isForm) {
        finalHeaders["Content-Type"] = "application/x-www-form-urlencoded";
        finalBody =
          body instanceof URLSearchParams
            ? body.toString()
            : new URLSearchParams(body).toString();
      } else {
        finalHeaders["Content-Type"] = "application/json";
        finalBody = JSON.stringify(body);
      }
    }

    if (auth) {
      const token = this.getToken();
      if (token) finalHeaders["Authorization"] = `Bearer ${token}`;
    }

    let response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: finalHeaders,
        body: finalBody,
      });
    } catch (networkErr) {
      throw new ApiError(
        `Network error calling ${method} ${path}: ${networkErr.message}`,
        0,
        null
      );
    }

    if (response.status === 204) return null;

    const contentType = response.headers.get("content-type") || "";
    const parsed = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : await response.text().catch(() => null);

    if (!response.ok) {
      const message =
        (parsed && typeof parsed === "object" && (parsed.detail || parsed.message)) ||
        `Request failed: ${method} ${path} (${response.status})`;
      const err = new ApiError(
        typeof message === "string" ? message : JSON.stringify(message),
        response.status,
        parsed
      );

      if (response.status === 401) {
        this.setToken(null);
        if (this.onUnauthorized) this.onUnauthorized();
      }

      throw err;
    }

    return parsed;
  }
}

const apiClient = new FaithConnectApi();

async function apiRegister(userData) {
  const token = await apiClient.request("/auth/register", {
    method: "POST",
    body: userData,
    auth: false,
  });
  if (token?.access_token) apiClient.setToken(token.access_token);
  return token;
}

async function apiLogin(username, password) {
  const token = await apiClient.request("/auth/login", {
    method: "POST",
    isForm: LOGIN_BODY_MODE === "urlencoded",
    isMultipart: LOGIN_BODY_MODE === "multipart",
    body:
      LOGIN_BODY_MODE === "multipart"
        ? (() => {
            const fd = new FormData();
            fd.append("username", username);
            fd.append("password", password);
            return fd;
          })()
        : { username, password },
    auth: false,
  });
  if (token?.access_token) apiClient.setToken(token.access_token);
  return token;
}

function apiLogout() {
  apiClient.logout();
}

function apiMe() {
  return apiClient.request("/auth/me");
}

function apiGetPublicFeed(params = {}) {
  const q = new URLSearchParams();
  if (params.limit !== undefined) q.set("limit", params.limit);
  if (params.offset !== undefined) q.set("offset", params.offset);
  const query = q.toString() ? `?${q.toString()}` : "";
  return apiClient.request(`/feed${query}`);
}

// Church timeline shows ALL of that church's posts regardless of the
// post's own visibility flag (unlike the public /feed).
function apiGetChurchTimeline(churchId, params = {}) {
  const q = new URLSearchParams();
  if (params.limit !== undefined) q.set("limit", params.limit);
  if (params.offset !== undefined) q.set("offset", params.offset);
  const query = q.toString() ? `?${q.toString()}` : "";
  return apiClient.request(`/churches/${churchId}/timeline${query}`);
}

function apiGetChurch(churchId) {
  return apiClient.request(`/churches/${churchId}`);
}

/** @param {{brandId?: string}} [params] */
function apiGetChurches(params = {}) {
  const query = params.brandId ? `?brand_id=${encodeURIComponent(params.brandId)}` : "";
  return apiClient.request(`/churches${query}`);
}

function apiGetBrands() {
  return apiClient.request("/brands");
}

/** @param {{name: string, description?: string, brand_id?: string}} churchData */
function apiCreateChurch(churchData) {
  return apiClient.request("/churches", { method: "POST", body: churchData });
}

/**
 * Admin trust stamp — per the spec, a church's own owner-tagged members
 * are NOT given this by default, only platform admins. Expect a 403 for
 * most users; the UI below surfaces that rather than hiding the button.
 */
function apiVerifyChurch(churchId) {
  return apiClient.request(`/churches/${churchId}/verify`, { method: "PATCH" });
}

function apiListMembers(churchId) {
  return apiClient.request(`/churches/${churchId}/members`);
}

/** Covers both self-join and an admin adding another user by id. */
function apiAddMember(churchId, memberData) {
  return apiClient.request(`/churches/${churchId}/members`, {
    method: "POST",
    body: memberData,
  });
}

function apiRemoveMember(churchId, userId) {
  return apiClient.request(`/churches/${churchId}/members/${userId}`, {
    method: "DELETE",
  });
}

function apiListTags(churchId) {
  return apiClient.request(`/churches/${churchId}/tags`);
}

/** @param {{name: string}} tagData */
function apiCreateTag(churchId, tagData) {
  return apiClient.request(`/churches/${churchId}/tags`, {
    method: "POST",
    body: tagData,
  });
}

function apiAssignTag(churchId, userId, tagAssignment) {
  return apiClient.request(`/churches/${churchId}/members/${userId}/tags`, {
    method: "POST",
    body: tagAssignment,
  });
}

function apiRevokeTag(churchId, userId, tagId) {
  return apiClient.request(`/churches/${churchId}/members/${userId}/tags/${tagId}`, {
    method: "DELETE",
  });
}

/** Open self-join path — no admin approval needed for a public church. */
function apiJoinChurch(churchId) {
  return apiClient.request(`/churches/${churchId}/join`, { method: "POST" });
}

/** @param {string} churchId @param {{content: string}} data */
function apiSendGcMessage(churchId, data) {
  return apiClient.request(`/churches/${churchId}/gc/messages`, {
    method: "POST",
    body: data,
  });
}

/** @param {string} churchId @param {{limit?: number, before?: string}} [params] */
function apiListGcMessages(churchId, params = {}) {
  const q = new URLSearchParams();
  if (params.limit !== undefined) q.set("limit", params.limit);
  if (params.before) q.set("before", params.before);
  const query = q.toString() ? `?${q.toString()}` : "";
  return apiClient.request(`/churches/${churchId}/gc/messages${query}`);
}

/** @param {string} churchId @param {string} messageId */
function apiDeleteGcMessage(churchId, messageId) {
  return apiClient.request(`/churches/${churchId}/gc/messages/${messageId}`, {
    method: "DELETE",
  });
}

function apiGetUserChurchHistory(userId) {
  return apiClient.request(`/users/${userId}/churches`);
}

/**
 * Generic upload — returns a MediaOut whose `id` can then be attached to a
 * post, story, event, avatar, etc. Used here for optional story images.
 * @param {File} file
 */
function apiUploadMedia(file) {
  const formData = new FormData();
  formData.append("file", file);
  return apiClient.request("/uploads", {
    method: "POST",
    isMultipart: true,
    body: formData,
  });
}

/**
 * @param {string} churchId
 * @param {{content?: string, media_id?: string}} data
 * Field names are a best guess at StoryCreate — swap if your real schema differs.
 */
function apiCreateStory(churchId, data) {
  return apiClient.request(`/churches/${churchId}/stories`, {
    method: "POST",
    body: data,
  });
}

// Members-only; the API auto-filters expired stories, so whatever comes
// back here is already "active."
function apiListActiveStories(churchId) {
  return apiClient.request(`/churches/${churchId}/stories`);
}

function apiCreatePost(churchId, data) {
  return apiClient.request(`/churches/${churchId}/posts`, {
    method: "POST",
    body: data,
  });
}

function apiLikePost(postId) {
  return apiClient.request(`/posts/${postId}/like`, { method: "POST" });
}

function apiUnlikePost(postId) {
  return apiClient.request(`/posts/${postId}/like`, { method: "DELETE" });
}

// =====================================================================
// 2. AUTH CONTEXT
// =====================================================================

const AuthContext = createContext(null);

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore session on first load (page refresh keeps you logged in).
  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      if (!apiClient.isAuthenticated()) {
        setLoading(false);
        return;
      }
      try {
        const currentUser = await apiMe();
        if (!cancelled) setUser(currentUser);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  // Drop the session immediately if any request comes back 401.
  useEffect(() => {
    apiClient.onUnauthorized = () => setUser(null);
    return () => {
      apiClient.onUnauthorized = null;
    };
  }, []);

  const login = useCallback(async (username, password) => {
    await apiLogin(username, password);
    const currentUser = await apiMe();
    setUser(currentUser);
    return currentUser;
  }, []);

  // apiRegister already saves the token to localStorage on success — we
  // just need to fetch /auth/me afterward so the user is in context too,
  // same as login().
  const register = useCallback(async (userData) => {
    await apiRegister(userData);
    const currentUser = await apiMe();
    setUser(currentUser);
    return currentUser;
  }, []);

  const logout = useCallback(() => {
    apiLogout();
    setUser(null);
  }, []);

  const value = { user, loading, isAuthenticated: Boolean(user), login, register, logout };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside an <AuthProvider>");
  return ctx;
}

// =====================================================================
// 3. PROTECTED ROUTE
// =====================================================================

function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#EEF5FB]">
        <p className="text-sm text-[#17212B]/60">Loading your session…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}

// =====================================================================
// 4. LOGIN PAGE
// =====================================================================

function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const redirectTo = location.state?.from?.pathname || "/feed";

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError("Enter both email and password.");
      return;
    }

    setSubmitting(true);
    try {
      await login(email, password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err?.message || "Couldn't sign you in. Check your details and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#EEF5FB]">
      <header className="bg-[#174A7E] px-6 py-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-white">FaithConnect</h1>
        <p className="mt-1 text-sm text-white/70">
          A digital home for Christian connection and growth.
        </p>
      </header>

      <main className="flex flex-1 items-start justify-center px-6 py-10 sm:items-center">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5"
        >
          <h2 className="mb-6 text-lg font-semibold text-[#17212B]">Welcome back</h2>

          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-medium text-[#17212B]">Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
              placeholder="you@example.com"
            />
          </label>

          <label className="mb-2 block">
            <span className="mb-1 block text-sm font-medium text-[#17212B]">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
              placeholder="••••••••"
            />
          </label>

          {error && (
            <p role="alert" className="mb-4 mt-2 text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-4 w-full rounded-lg bg-[#D9A72A] py-2.5 font-semibold text-[#17212B] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>

          <p className="mt-4 text-center text-sm text-[#17212B]/60">
            New here?{" "}
            <Link to="/register" className="font-medium text-[#174A7E] hover:underline">
              Create an account
            </Link>
          </p>
        </form>
      </main>
    </div>
  );
}

// =====================================================================
// 4B. REGISTER PAGE
// =====================================================================

function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!name || !email || !password) {
      setError("Fill in your name, email, and password.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      // Adjust these field names to match your real UserCreate schema
      // (e.g. it may want `username` instead of `email`, or split first/last name).
      await register({ name, email, password });
      navigate("/feed", { replace: true });
    } catch (err) {
      setError(err?.message || "Couldn't create your account. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#EEF5FB]">
      <header className="bg-[#174A7E] px-6 py-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-white">FaithConnect</h1>
        <p className="mt-1 text-sm text-white/70">
          A digital home for Christian connection and growth.
        </p>
      </header>

      <main className="flex flex-1 items-start justify-center px-6 py-10 sm:items-center">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5"
        >
          <h2 className="mb-6 text-lg font-semibold text-[#17212B]">Create your account</h2>

          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-medium text-[#17212B]">Full name</span>
            <input
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
              placeholder="Jane Doe"
            />
          </label>

          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-medium text-[#17212B]">Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
              placeholder="you@example.com"
            />
          </label>

          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-medium text-[#17212B]">Password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
              placeholder="••••••••"
            />
          </label>

          <label className="mb-2 block">
            <span className="mb-1 block text-sm font-medium text-[#17212B]">Confirm password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
              placeholder="••••••••"
            />
          </label>

          {error && (
            <p role="alert" className="mb-4 mt-2 text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-4 w-full rounded-lg bg-[#D9A72A] py-2.5 font-semibold text-[#17212B] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Creating account…" : "Create account"}
          </button>

          <p className="mt-4 text-center text-sm text-[#17212B]/60">
            Already have an account?{" "}
            <Link to="/login" className="font-medium text-[#174A7E] hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </main>
    </div>
  );
}

// =====================================================================
// 5. POST CARD
// =====================================================================

function PostCard({ post, onLikeChange }) {
  const [liked, setLiked] = useState(Boolean(post.liked_by_me));
  const [likeCount, setLikeCount] = useState(post.like_count ?? 0);
  const [pending, setPending] = useState(false);

  async function handleToggleLike() {
    if (pending) return;

    const nextLiked = !liked;
    const previousLiked = liked;
    const previousCount = likeCount;

    setLiked(nextLiked);
    setLikeCount((c) => c + (nextLiked ? 1 : -1));
    setPending(true);

    try {
      if (nextLiked) {
        await apiLikePost(post.id);
      } else {
        await apiUnlikePost(post.id);
      }
      onLikeChange?.(post.id, nextLiked);
    } catch {
      setLiked(previousLiked);
      setLikeCount(previousCount);
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      <header className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-[#17212B]">
          {post.author_name || "Community member"}
        </span>
        {post.created_at && (
          <time className="text-xs text-[#17212B]/50" dateTime={post.created_at}>
            {new Date(post.created_at).toLocaleDateString()}
          </time>
        )}
      </header>

      <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#17212B]">
        {post.content}
      </p>

      <footer className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={handleToggleLike}
          disabled={pending}
          aria-pressed={liked}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${
            liked ? "bg-[#D9A72A] text-[#17212B]" : "bg-[#174A7E] text-white hover:opacity-90"
          }`}
        >
          <span aria-hidden="true">{liked ? "★" : "☆"}</span>
          {liked ? "Liked" : "Like"}
          {likeCount > 0 && <span className="opacity-80">· {likeCount}</span>}
        </button>
      </footer>
    </article>
  );
}

// =====================================================================
// 6. CREATE POST FORM
// =====================================================================

function CreatePostForm({ churchId, onPostCreated }) {
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    const trimmed = content.trim();
    if (!trimmed) return;

    if (!churchId) {
      setError("No church selected — can't post without a church_id.");
      return;
    }

    setSubmitting(true);
    try {
      const newPost = await apiCreatePost(churchId, { content: trimmed });
      setContent("");
      onPostCreated?.(newPost);
    } catch (err) {
      setError(err?.message || "Couldn't publish that post. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5"
    >
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Share something with your church…"
        rows={3}
        className="w-full resize-none rounded-lg border border-[#17212B]/15 p-3 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
      />

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-3 flex justify-end">
        <button
          type="submit"
          disabled={submitting || !content.trim()}
          className="rounded-lg bg-[#D9A72A] px-4 py-2 text-sm font-semibold text-[#17212B] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Posting…" : "Post"}
        </button>
      </div>
    </form>
  );
}

// =====================================================================
// 7. FEED PAGE
// =====================================================================

function FeedPage() {
  const { user, logout } = useAuth();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadFeed = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiGetPublicFeed({ limit: 20, offset: 0 });
      setPosts(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || "Couldn't load the feed. Pull to refresh or try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  function handlePostCreated(newPost) {
    setPosts((prev) => [newPost, ...prev]);
  }

  return (
    <div className="min-h-screen bg-[#EEF5FB] pb-16">
      <header className="flex items-center justify-between bg-[#174A7E] px-4 py-4 sm:px-6">
        <h1 className="text-lg font-semibold text-white">FaithConnect Feed</h1>
        <div className="flex items-center gap-4">
          <Link to="/churches" className="text-sm font-medium text-white/90 hover:text-white">
            Find a church
          </Link>
          <Link to="/profile" className="text-sm font-medium text-white/90 hover:text-white">
            Profile
          </Link>
          <button
            type="button"
            onClick={logout}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-white/90 hover:bg-white/10"
          >
            Log out
          </button>
        </div>
      </header>

      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6 sm:px-6">
        {user?.church_id ? (
          <>
            <CreatePostForm churchId={user.church_id} onPostCreated={handlePostCreated} />
            <Link
              to={`/churches/${user.church_id}/timeline`}
              className="text-center text-sm font-medium text-[#174A7E] hover:underline"
            >
              View my church's full timeline →
            </Link>
          </>
        ) : (
          <p className="rounded-lg bg-white/60 p-3 text-center text-xs text-[#17212B]/60 ring-1 ring-black/5">
            Join a church to post to the feed.
          </p>
        )}

        {loading && <p className="py-8 text-center text-sm text-[#17212B]/50">Loading feed…</p>}

        {!loading && error && (
          <div className="rounded-lg bg-white p-4 text-center ring-1 ring-black/5">
            <p className="mb-3 text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={loadFeed}
              className="rounded-lg bg-[#174A7E] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && posts.length === 0 && (
          <div className="rounded-lg bg-white p-8 text-center ring-1 ring-black/5">
            <p className="text-sm text-[#17212B]/60">
              No posts yet — be the first to share something.
            </p>
          </div>
        )}

        {!loading && !error && posts.map((post) => <PostCard key={post.id} post={post} />)}
      </main>
    </div>
  );
}

// =====================================================================
// 7B. CHURCH TIMELINE PAGE
// =====================================================================

const TIMELINE_PAGE_SIZE = 20;

/**
 * Protected page showing a single church's full timeline (every post,
 * regardless of visibility flag) with "Load more" pagination.
 * Route: /churches/:churchId/timeline
 */
function ChurchTimelinePage() {
  const { churchId } = useParams();
  const { user } = useAuth();

  const [church, setChurch] = useState(null);
  const [posts, setPosts] = useState([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const [loading, setLoading] = useState(true); // initial load
  const [loadingMore, setLoadingMore] = useState(false); // "load more" clicks
  const [error, setError] = useState("");

  // Load the church's name/details once.
  useEffect(() => {
    let cancelled = false;
    apiGetChurch(churchId)
      .then((data) => {
        if (!cancelled) setChurch(data);
      })
      .catch(() => {
        /* Non-fatal — the timeline still works without the header info. */
      });
    return () => {
      cancelled = true;
    };
  }, [churchId]);

  const loadPage = useCallback(
    async (targetOffset, { append }) => {
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setError("");
      }

      try {
        const data = await apiGetChurchTimeline(churchId, {
          limit: TIMELINE_PAGE_SIZE,
          offset: targetOffset,
        });
        const page = Array.isArray(data) ? data : [];

        setPosts((prev) => (append ? [...prev, ...page] : page));
        setOffset(targetOffset + page.length);
        setHasMore(page.length === TIMELINE_PAGE_SIZE);
      } catch (err) {
        setError(err?.message || "Couldn't load this church's timeline.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [churchId]
  );

  // Reset and reload whenever the church_id in the URL changes.
  useEffect(() => {
    setPosts([]);
    setOffset(0);
    setHasMore(true);
    loadPage(0, { append: false });
  }, [churchId, loadPage]);

  function handlePostCreated(newPost) {
    setPosts((prev) => [newPost, ...prev]);
  }

  const isOwnChurch = user?.church_id === churchId;

  return (
    <div className="min-h-screen bg-[#EEF5FB] pb-16">
      <header className="bg-[#174A7E] px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between">
          <Link to="/feed" className="text-sm font-medium text-white/70 hover:text-white">
            ← Back to feed
          </Link>
          <Link
            to={`/churches/${churchId}/chat`}
            className="text-sm font-medium text-white/90 hover:text-white"
          >
            Group Chat →
          </Link>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-white">
            {church?.name || "Church timeline"}
          </h1>
          <div className="flex items-center gap-3">
            {isOwnChurch && (
              <Link
                to={`/churches/${churchId}/manage`}
                className="text-sm font-medium text-white/90 hover:text-white"
              >
                Manage →
              </Link>
            )}
            <Link
              to={`/churches/${churchId}/stories`}
              className="text-sm font-medium text-white/90 hover:text-white"
            >
              Stories →
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6 sm:px-6">
        {isOwnChurch && (
          <CreatePostForm churchId={churchId} onPostCreated={handlePostCreated} />
        )}

        {loading && (
          <p className="py-8 text-center text-sm text-[#17212B]/50">Loading timeline…</p>
        )}

        {!loading && error && (
          <div className="rounded-lg bg-white p-4 text-center ring-1 ring-black/5">
            <p className="mb-3 text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={() => loadPage(0, { append: false })}
              className="rounded-lg bg-[#174A7E] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && posts.length === 0 && (
          <div className="rounded-lg bg-white p-8 text-center ring-1 ring-black/5">
            <p className="text-sm text-[#17212B]/60">
              No posts on this timeline yet.
            </p>
          </div>
        )}

        {!loading && !error && posts.map((post) => <PostCard key={post.id} post={post} />)}

        {!loading && !error && hasMore && posts.length > 0 && (
          <button
            type="button"
            onClick={() => loadPage(offset, { append: true })}
            disabled={loadingMore}
            className="mx-auto rounded-lg border border-[#174A7E]/20 bg-white px-4 py-2 text-sm font-medium text-[#174A7E] hover:bg-[#174A7E]/5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        )}
      </main>
    </div>
  );
}

// =====================================================================
// 7C. LANDING PAGE (public)
// =====================================================================
//
// NOTE ON SCOPE: several things shown here — Bible Hub, Live Streaming,
// Learning Academy, Christian Marketplace, Giving, Missions & Outreach —
// are NOT in the openapi.json spec we have (only auth, churches,
// memberships, tags, group-chat messages, stories, posts, and feed/likes
// are real endpoints today). This page sells the full vision, so those
// cards are marked "Coming soon" rather than linked anywhere, so nothing
// promises functionality the backend can't deliver yet. As those
// endpoints ship, swap the card's onClick/Link in and drop the badge.

/**
 * Small reusable mark: concentric rings, one gathering point rippling
 * outward. Used large and faint in the hero, then small again in the
 * footer, so it reads as a signature rather than a one-off decoration.
 */
function ConnectionMark({ className = "" }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" className={className} aria-hidden="true">
      <circle cx="60" cy="60" r="6" fill="#D9A72A" />
      <circle cx="60" cy="60" r="22" stroke="#D9A72A" strokeWidth="1.5" opacity="0.55" />
      <circle cx="60" cy="60" r="40" stroke="#174A7E" strokeWidth="1.5" opacity="0.35" />
      <circle cx="60" cy="60" r="58" stroke="#174A7E" strokeWidth="1.5" opacity="0.18" />
    </svg>
  );
}

/**
 * Abstract globe — latitude/longitude arcs plus small dots standing in for
 * people scattered across places. Deliberately not a cross, dove, fish, or
 * any single tradition's symbol, since the section it illustrates is about
 * many traditions gathered around one purpose, not one denomination's look.
 */
function GlobeMark({ className = "" }) {
  return (
    <svg viewBox="0 0 200 200" fill="none" className={className} aria-hidden="true">
      <circle cx="100" cy="100" r="72" stroke="#174A7E" strokeWidth="1.5" opacity="0.5" />
      <ellipse cx="100" cy="100" rx="72" ry="26" stroke="#174A7E" strokeWidth="1.2" opacity="0.35" />
      <ellipse cx="100" cy="100" rx="72" ry="50" stroke="#174A7E" strokeWidth="1.2" opacity="0.3" />
      <line x1="28" y1="100" x2="172" y2="100" stroke="#174A7E" strokeWidth="1.2" opacity="0.3" />
      <line x1="100" y1="28" x2="100" y2="172" stroke="#174A7E" strokeWidth="1.2" opacity="0.25" />
      {[
        [70, 55],
        [138, 72],
        [55, 128],
        [128, 138],
        [100, 40],
        [160, 105],
      ].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={i % 2 === 0 ? 5 : 4} fill="#D9A72A" opacity={0.9} />
      ))}
    </svg>
  );
}

/** Minimal, dependency-free glyph set — one simple stroke icon per feature/audience card. */
function FeatureGlyph({ kind, className = "" }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };
  const paths = {
    social: <><path d="M5 8a3 3 0 1 1 6 0 3 3 0 0 1-6 0Z" {...common} /><path d="M2 19c0-3 2.5-5 6-5s6 2 6 5" {...common} /><path d="M14 8a2.4 2.4 0 1 1 4.8 0" {...common} /><path d="M15 19c.3-2.4 2-4 4-4.4" {...common} /></>,
    church: <><path d="M4 20h16" {...common} /><path d="M6 20V10l6-5 6 5v10" {...common} /><path d="M10 20v-6h4v6" {...common} /><path d="M12 3v3" {...common} /><path d="M10.5 4.5h3" {...common} /></>,
    prayer: <><path d="M12 21c-4-2.5-7-6-7-10a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 4-3 7.5-7 10Z" {...common} /></>,
    live: <><rect x="3" y="6" width="14" height="12" rx="2" {...common} /><path d="M17 10l4-2.5v9L17 14" {...common} /></>,
    bible: <><path d="M4 5c2-1 5-1 7 .5V19c-2-1.5-5-1.5-7-.5Z" {...common} /><path d="M20 5c-2-1-5-1-7 .5V19c2-1.5 5-1.5 7-.5Z" {...common} /></>,
    academy: <><path d="M12 5 2 9l10 4 10-4Z" {...common} /><path d="M6 11v5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-5" {...common} /></>,
    events: <><rect x="3" y="5" width="18" height="15" rx="2" {...common} /><path d="M3 10h18" {...common} /><path d="M8 3v4M16 3v4" {...common} /></>,
    marketplace: <><path d="M4 8h16l-1.5 10a2 2 0 0 1-2 1.7H7.5a2 2 0 0 1-2-1.7Z" {...common} /><path d="M8 8V6a4 4 0 0 1 8 0v2" {...common} /></>,
    discussions: <><path d="M4 5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H10l-5 4v-4H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" {...common} /></>,
    media: <><rect x="3" y="4" width="18" height="13" rx="2" {...common} /><path d="M3 17l5-5 4 4 3-3 6 6" {...common} /></>,
    giving: <><path d="M12 8v13" {...common} /><path d="M8 21h8" {...common} /><rect x="4" y="4" width="16" height="7" rx="2" {...common} /><path d="M12 4v0" {...common} /></>,
    missions: <><path d="M12 21s7-5.5 7-11a7 7 0 0 0-14 0c0 5.5 7 11 7 11Z" {...common} /><circle cx="12" cy="10" r="2.5" {...common} /></>,
    believer: <><path d="M12 21c-4-2.5-7-6-7-10a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 4-3 7.5-7 10Z" {...common} /></>,
    professional: <><rect x="4" y="7" width="16" height="12" rx="2" {...common} /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" {...common} /></>,
    creator: <><rect x="3" y="4" width="18" height="13" rx="2" {...common} /><path d="M10 9.5 15 12l-5 2.5Z" {...common} /></>,
    organization: <><path d="M4 20V9l8-5 8 5v11" {...common} /><path d="M9 20v-6h6v6" {...common} /></>,
  };
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      {paths[kind] || paths.social}
    </svg>
  );
}

const FEATURE_GRID = [
  { kind: "social", title: "Social Community", body: "Post, follow, and connect with believers worldwide." },
  { kind: "church", title: "Church Hub", body: "Every church gets a verified home base for its members." },
  { kind: "prayer", title: "Prayer Network", body: "Share requests and stand with people praying in real time." },
  { kind: "live", title: "Live Streaming", body: "Join services and worship nights as they happen." },
  { kind: "bible", title: "Bible Hub", body: "Read, highlight, and study scripture together." },
  { kind: "academy", title: "Learning Academy", body: "Courses on discipleship, theology, and ministry skills." },
  { kind: "events", title: "Events", body: "Find retreats, conferences, and gatherings near you." },
  { kind: "marketplace", title: "Christian Marketplace", body: "Discover goods and services from Christian creators." },
  { kind: "discussions", title: "Discussions", body: "Ask questions and go deeper on faith topics that matter to you." },
  { kind: "media", title: "Blogs & Media", body: "Articles, testimonies, and media from across the Church." },
  { kind: "giving", title: "Giving", body: "Support your church or a cause with a few taps." },
  { kind: "missions", title: "Missions & Outreach", body: "Find and support mission work happening globally." },
];

const FOR_EVERYONE = [
  { kind: "believer", title: "Believers", body: "A home base for your walk — community, prayer, and growth in one place." },
  { kind: "church", title: "Churches", body: "Reach your congregation between Sundays with a verified digital presence." },
  { kind: "missions", title: "Ministries", body: "Share your work and connect with supporters and volunteers globally." },
  { kind: "professional", title: "Christian Professionals", body: "Network with others living out their faith at work." },
  { kind: "creator", title: "Christian Creators", body: "Reach an audience already looking for faith-centered content." },
  { kind: "organization", title: "Christian Organizations", body: "Coordinate outreach, events, and giving in one connected place." },
];

/** Endpoints that exist today vs. the fuller vision — see the NOTE above the page. */
const LIVE_FEATURE_TITLES = new Set(["Social Community", "Church Hub"]);

/** A stripped-down phone frame used three times in the hero, each showing a different screen. */
function PhoneMock({ label, accent = "#174A7E", children, className = "" }) {
  return (
    <div
      className={`w-40 shrink-0 rounded-[1.75rem] border-4 border-[#17212B] bg-white p-1.5 shadow-xl sm:w-48 ${className}`}
    >
      <div className="flex items-center justify-between px-2 pb-1">
        <span className="h-1 w-6 rounded-full bg-[#17212B]/20" />
        <span className="text-[9px] font-semibold uppercase tracking-wide text-[#17212B]/40">
          {label}
        </span>
      </div>
      <div className="h-52 overflow-hidden rounded-2xl sm:h-64" style={{ backgroundColor: "#EEF5FB" }}>
        <div className="h-2 w-full" style={{ backgroundColor: accent }} />
        <div className="space-y-2 p-2.5">{children}</div>
      </div>
    </div>
  );
}

function LandingPage() {
  const { isAuthenticated } = useAuth();

  // Real data for the "Feed" phone mockup — /feed is a genuine public
  // endpoint, so this preview isn't fabricated like the Prayer Room/Bible
  // Hub ones (those aren't real endpoints yet, see the NOTE above).
  const [heroPosts, setHeroPosts] = useState([]);
  const [heroFeedLoading, setHeroFeedLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiGetPublicFeed({ limit: 2 })
      .then((data) => {
        if (!cancelled) setHeroPosts(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        /* Non-fatal — the mockup just shows its empty state. */
      })
      .finally(() => {
        if (!cancelled) setHeroFeedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-white text-[#17212B]">
      {/* ---- Top nav ---- */}
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <span
          className="text-lg font-semibold tracking-tight text-[#174A7E]"
          style={{ fontFamily: "'Fraunces', serif" }}
        >
          FaithConnect
        </span>
        <div className="flex items-center gap-3">
          {isAuthenticated ? (
            <Link
              to="/feed"
              className="rounded-lg bg-[#174A7E] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Go to feed
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                className="hidden text-sm font-medium text-[#17212B]/70 hover:text-[#17212B] sm:inline"
              >
                Sign in
              </Link>
              <Link
                to="/register"
                className="rounded-lg bg-[#D9A72A] px-4 py-2 text-sm font-semibold text-[#17212B] hover:opacity-90"
              >
                Join — it's free
              </Link>
            </>
          )}
        </div>
      </nav>

      {/* =================================================================
          HERO
      ================================================================== */}
      <header className="relative mx-auto max-w-6xl overflow-hidden px-6 pb-16 pt-6 sm:pb-24 sm:pt-10">
        <ConnectionMark className="pointer-events-none absolute -right-16 -top-16 h-72 w-72 sm:h-[26rem] sm:w-[26rem]" />

        <div className="relative grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
          {/* Copy */}
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-[#D9A72A]">
              For every believer, every church, everywhere
            </p>
            <h1
              className="mt-4 text-4xl leading-[1.1] text-[#17212B] sm:text-5xl"
              style={{ fontFamily: "'Fraunces', serif" }}
            >
              The Digital Home of the Global Church
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-[#17212B]/70">
              Connect with believers, churches and ministries around the
              world. Grow in faith, join meaningful conversations, pray
              together, discover events, learn, serve and make an impact.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to={isAuthenticated ? "/feed" : "/register"}
                className="rounded-lg bg-[#174A7E] px-6 py-3 text-sm font-semibold text-white hover:opacity-90"
              >
                {isAuthenticated ? "Go to feed" : "Join FaithConnect — It's Free"}
              </Link>
              <a
                href="#everything"
                className="rounded-lg border border-[#174A7E]/25 px-6 py-3 text-sm font-semibold text-[#174A7E] hover:bg-[#174A7E]/5"
              >
                Explore FaithConnect
              </a>
            </div>
          </div>

          {/* Phone mockups: Feed (real data), Prayer Room + Bible Hub (previews — not real endpoints yet) */}
          <div className="relative flex items-center justify-center gap-3 py-6 sm:gap-4">
            <PhoneMock label="Prayer Room · Preview" accent="#D9A72A" className="hidden -rotate-6 translate-y-4 sm:block">
              <div className="rounded-lg bg-white p-2 text-[9px] text-[#17212B]/70 shadow-sm">
                🇰🇪 Praying for healing
              </div>
              <div className="rounded-lg bg-white p-2 text-[9px] text-[#17212B]/70 shadow-sm">
                🇵🇭 Praying for provision
              </div>
              <div className="rounded-lg bg-[#D9A72A]/15 p-2 text-center text-[9px] font-medium text-[#17212B]/60">
                Coming soon
              </div>
            </PhoneMock>

            <PhoneMock label="Feed" accent="#174A7E" className="z-10 shadow-2xl">
              {heroFeedLoading && (
                <>
                  <div className="rounded-lg bg-white p-2 shadow-sm">
                    <div className="mb-1 h-1.5 w-16 rounded-full bg-[#17212B]/15" />
                    <div className="h-1.5 w-24 rounded-full bg-[#17212B]/10" />
                  </div>
                  <div className="rounded-lg bg-white p-2 shadow-sm">
                    <div className="mb-1 h-1.5 w-20 rounded-full bg-[#17212B]/15" />
                    <div className="h-1.5 w-14 rounded-full bg-[#17212B]/10" />
                  </div>
                </>
              )}

              {!heroFeedLoading && heroPosts.length === 0 && (
                <div className="rounded-lg bg-white p-2 text-[9px] text-[#17212B]/50 shadow-sm">
                  Real posts from the FaithConnect feed show up here.
                </div>
              )}

              {!heroFeedLoading &&
                heroPosts.map((post) => (
                  <div key={post.id} className="rounded-lg bg-white p-2 shadow-sm">
                    <p className="line-clamp-2 text-[9px] leading-snug text-[#17212B]/75">
                      {post.content}
                    </p>
                    <p className="mt-1 truncate text-[8px] font-medium text-[#17212B]/40">
                      {post.author_name || "Community member"}
                    </p>
                  </div>
                ))}

              {!heroFeedLoading && heroPosts.length > 0 && (
                <div className="flex gap-1.5">
                  <span className="rounded-full bg-[#D9A72A]/20 px-2 py-0.5 text-[8px] font-medium text-[#17212B]">
                    ★ {heroPosts[0].like_count ?? 0}
                  </span>
                </div>
              )}
            </PhoneMock>

            <PhoneMock label="Bible Hub · Preview" accent="#174A7E" className="hidden rotate-6 translate-y-4 sm:block">
              <div className="rounded-lg bg-white p-2 text-[9px] leading-snug text-[#17212B]/70 shadow-sm">
                Read and study scripture together.
              </div>
              <div className="rounded-lg bg-[#174A7E]/10 p-2 text-center text-[9px] font-medium text-[#17212B]/60">
                Coming soon
              </div>
            </PhoneMock>
          </div>
        </div>
      </header>

      {/* =================================================================
          EVERYTHING YOU NEED
      ================================================================== */}
      <section id="everything" className="bg-[#EEF5FB] px-6 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <h2
            className="max-w-lg text-2xl text-[#17212B] sm:text-3xl"
            style={{ fontFamily: "'Fraunces', serif" }}
          >
            Everything you need. All in one place.
          </h2>

          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURE_GRID.map((feature) => (
              <div
                key={feature.title}
                className="relative rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5"
              >
                {!LIVE_FEATURE_TITLES.has(feature.title) && (
                  <span className="absolute right-4 top-4 rounded-full bg-[#17212B]/5 px-2 py-0.5 text-[10px] font-medium text-[#17212B]/40">
                    Coming soon
                  </span>
                )}
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#174A7E]/10 text-[#174A7E]">
                  <FeatureGlyph kind={feature.kind} className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-semibold text-[#17212B]">{feature.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[#17212B]/60">{feature.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* =================================================================
          ONE FAITH. MANY VOICES.
      ================================================================== */}
      <section className="px-6 py-16 sm:py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1fr_1fr]">
          <div className="order-2 flex justify-center lg:order-1">
            <GlobeMark className="h-64 w-64 sm:h-80 sm:w-80" />
          </div>
          <div className="order-1 lg:order-2">
            <h2
              className="text-2xl text-[#17212B] sm:text-3xl"
              style={{ fontFamily: "'Fraunces', serif" }}
            >
              One faith. Many voices. Global impact.
            </h2>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-[#17212B]/70">
              People from different nations, cultures, and denominations
              coming together for one purpose — Jesus. FaithConnect isn't
              built for one tradition or one corner of the world; it's built
              for the whole, global Church.
            </p>
          </div>
        </div>
      </section>

      {/* =================================================================
          WHY FAITHCONNECT
      ================================================================== */}
      <section className="bg-[#174A7E] px-6 py-16 text-white sm:py-20">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl sm:text-3xl" style={{ fontFamily: "'Fraunces', serif" }}>
            Why FaithConnect?
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/75">
            Mainstream social platforms weren't built around fellowship,
            discipleship, prayer, or ministry — faith is an afterthought
            bolted onto feeds designed for something else entirely.
            FaithConnect starts from the opposite direction: every feature
            here exists because the global Church actually needs it.
          </p>
        </div>
      </section>

      {/* =================================================================
          FOR EVERYONE
      ================================================================== */}
      <section className="px-6 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <h2
            className="text-2xl text-[#17212B] sm:text-3xl"
            style={{ fontFamily: "'Fraunces', serif" }}
          >
            For everyone in the Church.
          </h2>

          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FOR_EVERYONE.map((card) => (
              <div
                key={card.title}
                className="rounded-2xl bg-[#EEF5FB] p-5 ring-1 ring-black/5"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white text-[#D9A72A] shadow-sm">
                  <FeatureGlyph kind={card.kind} className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-semibold text-[#17212B]">{card.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[#17212B]/60">{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* =================================================================
          PRAYER NETWORK
      ================================================================== */}
      <section className="bg-[#EEF5FB] px-6 py-16 sm:py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1fr_1fr]">
          <div>
            <h2
              className="text-2xl text-[#17212B] sm:text-3xl"
              style={{ fontFamily: "'Fraunces', serif" }}
            >
              You don't have to pray alone.
            </h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-[#17212B]/70">
              Share a request and watch people from around the world stand
              with you in real time — a live room where distance never gets
              in the way of standing together in prayer.
            </p>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-lg ring-1 ring-black/5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#17212B]/40">
                Prayer Room
              </span>
              <span className="rounded-full bg-[#17212B]/5 px-2 py-0.5 text-[10px] font-medium text-[#17212B]/40">
                Preview — coming soon
              </span>
            </div>
            <ul className="space-y-2.5">
              {[
                ["🇧🇷", "Brazil", "praying for their family"],
                ["🇳🇬", "Nigeria", "praying for a new job"],
                ["🇵🇭", "Philippines", "praying for healing"],
                ["🇺🇸", "United States", "praying for their church"],
                ["🇰🇷", "South Korea", "praying for the persecuted Church"],
              ].map(([flag, place, need]) => (
                <li key={place} className="flex items-center gap-3 rounded-lg bg-[#EEF5FB] px-3 py-2">
                  <span className="text-lg" aria-hidden="true">{flag}</span>
                  <span className="text-sm text-[#17212B]/70">
                    <span className="font-medium text-[#17212B]">{place}</span> — {need}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-center text-xs text-[#17212B]/40">
              An illustration of what the Prayer Network will look like.
            </p>
          </div>
        </div>
      </section>

      {/* =================================================================
          CHURCH & MINISTRY HUB
      ================================================================== */}
      <section className="px-6 py-16 sm:py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-2xl bg-[#174A7E] p-6 text-white shadow-lg lg:order-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/50">
              Church Hub preview
            </p>
            <div className="mt-3 rounded-xl bg-white/10 p-4">
              <div className="mb-2 h-2 w-32 rounded-full bg-white/30" />
              <div className="h-2 w-20 rounded-full bg-white/20" />
              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[10px] text-white/70">
                <div className="rounded-lg bg-white/10 py-2">Live now</div>
                <div className="rounded-lg bg-white/10 py-2">Sermons</div>
                <div className="rounded-lg bg-white/10 py-2">Events</div>
              </div>
            </div>
          </div>

          <div className="lg:order-1">
            <h2
              className="text-2xl text-[#17212B] sm:text-3xl"
              style={{ fontFamily: "'Fraunces', serif" }}
            >
              A home base for your church.
            </h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-[#17212B]/70">
              Create your church's page, go live for a service, publish
              sermons, announce events, and stay connected with your
              members — all from one verified hub they already trust.
            </p>
          </div>
        </div>
      </section>

      {/* =================================================================
          FINAL CTA
      ================================================================== */}
      <section className="px-6 pb-16 sm:pb-20">
        <div className="mx-auto max-w-6xl rounded-2xl bg-[#174A7E] p-10 text-center sm:p-16">
          <h2
            className="text-2xl text-white sm:text-4xl"
            style={{ fontFamily: "'Fraunces', serif" }}
          >
            Your faith. Your community. Your global connection.
          </h2>
          <Link
            to={isAuthenticated ? "/feed" : "/register"}
            className="mt-8 inline-block rounded-lg bg-[#D9A72A] px-8 py-3.5 text-sm font-semibold text-[#17212B] hover:opacity-90"
          >
            {isAuthenticated ? "Go to feed" : "Join FaithConnect — It's Free"}
          </Link>
        </div>
      </section>

      {/* ---- Footer ---- */}
      <footer className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-6 pb-12 pt-4 text-center">
        <ConnectionMark className="h-10 w-10" />
        <p className="text-xs text-[#17212B]/50">
          FaithConnect — the digital home of the global Church.
        </p>
      </footer>
    </div>
  );
}

// =====================================================================
// 7D. PROFILE PAGE
// =====================================================================

/**
 * Read-only account overview: who you are, and every church you've ever
 * belonged to (active + past). The API's UserOut schema doesn't include a
 * profile-edit endpoint in the spec we have, so this page doesn't invent
 * one — it's a summary + membership history + sign-out, not a settings form.
 * If your backend adds a PATCH /auth/me later, an edit form slots in here.
 */
/**
 * Read-only account overview: who you are, and every church you've ever
 * belonged to (active + past). The API's UserOut schema doesn't include a
 * profile-edit endpoint in the spec we have, so this page doesn't invent
 * one — it's a summary + membership history + sign-out, not a settings form.
 * If your backend adds a PATCH /auth/me later, an edit form slots in here.
 *
 * AVATAR NOTE: uploading is real — the file genuinely goes to POST
 * /uploads and gets back a real MediaOut with a real URL. What's NOT real
 * is attaching it to the account: the spec has no PATCH /auth/me (or any
 * other endpoint) to save "this media is my avatar" server-side. So the
 * uploaded URL is only remembered in this browser's localStorage, keyed
 * by user id — it'll show here again next time you open the app on this
 * device, but won't show to anyone else, and won't follow you to another
 * device. Once the backend adds a real "set my avatar" endpoint, replace
 * the localStorage read/write below with a call to it.
 */
const AVATAR_STORAGE_PREFIX = "faithconnect_avatar_";

function ProfilePage() {
  const { user, logout } = useAuth();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [avatarUrl, setAvatarUrl] = useState(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState("");

  // Load whatever avatar URL was saved locally for this user, if any.
  useEffect(() => {
    if (!user?.id) return;
    try {
      const saved = localStorage.getItem(`${AVATAR_STORAGE_PREFIX}${user.id}`);
      if (saved) setAvatarUrl(saved);
    } catch {
      /* localStorage unavailable — avatar just won't persist, non-fatal. */
    }
  }, [user?.id]);

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;

    setUploadingAvatar(true);
    setAvatarError("");
    try {
      const media = await apiUploadMedia(file); // real upload, real URL back
      const url = media?.url;
      if (url) {
        setAvatarUrl(url);
        try {
          localStorage.setItem(`${AVATAR_STORAGE_PREFIX}${user.id}`, url);
        } catch {
          /* Non-fatal — it'll just re-upload next session instead of persisting. */
        }
      }
    } catch (err) {
      setAvatarError(err?.message || "Couldn't upload that image.");
    } finally {
      setUploadingAvatar(false);
      e.target.value = ""; // allow re-selecting the same file later
    }
  }

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    setLoading(true);
    setError("");
    apiGetUserChurchHistory(user.id)
      .then((data) => {
        if (!cancelled) setHistory(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || "Couldn't load your church history.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Split into active vs past memberships. Adjust the field name below
  // (`is_active` / `left_at` / `status`) to match your real MembershipOut
  // schema once you can see a sample response.
  const activeMemberships = history.filter((m) => !m.left_at && m.status !== "removed");
  const pastMemberships = history.filter((m) => m.left_at || m.status === "removed");

  return (
    <div className="min-h-screen bg-[#EEF5FB] pb-16">
      <header className="bg-[#174A7E] px-4 py-4 sm:px-6">
        <Link to="/feed" className="text-sm font-medium text-white/70 hover:text-white">
          ← Back to feed
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-white">Your profile</h1>
      </header>

      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6 sm:px-6">
        {/* ---- Account card ---- */}
        <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-black/5">
          <div className="flex items-center gap-4">
            <label className="relative shrink-0 cursor-pointer">
              <input
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                className="sr-only"
              />
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt=""
                  className="h-14 w-14 rounded-full object-cover ring-2 ring-[#174A7E]/20"
                />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#174A7E] text-lg font-semibold text-white">
                  {(user?.name || user?.email || "?").charAt(0).toUpperCase()}
                </div>
              )}
              <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#D9A72A] text-[10px] text-[#17212B] ring-2 ring-white">
                {uploadingAvatar ? "…" : "✎"}
              </span>
            </label>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-[#17212B]">
                {user?.name || "FaithConnect member"}
              </p>
              <p className="truncate text-sm text-[#17212B]/60">{user?.email}</p>
            </div>
          </div>

          {avatarError && <p className="mt-2 text-xs text-red-600">{avatarError}</p>}
          <p className="mt-2 text-xs text-[#17212B]/40">
            Tap your initials to upload a photo. It's saved on this device only — the
            backend doesn't have a way to attach it to your account yet.
          </p>

          <button
            type="button"
            onClick={logout}
            className="mt-5 w-full rounded-lg border border-[#174A7E]/25 py-2 text-sm font-medium text-[#174A7E] hover:bg-[#174A7E]/5"
          >
            Log out
          </button>
        </section>

        {/* ---- Church history ---- */}
        <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-black/5">
          <h2 className="text-sm font-semibold text-[#17212B]">Your churches</h2>

          {loading && (
            <p className="mt-3 text-sm text-[#17212B]/50">Loading church history…</p>
          )}

          {!loading && error && <p className="mt-3 text-sm text-red-600">{error}</p>}

          {!loading && !error && history.length === 0 && (
            <p className="mt-3 text-sm text-[#17212B]/60">
              You haven't joined a church yet.
            </p>
          )}

          {!loading && !error && activeMemberships.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-[#17212B]/40">
                Active
              </p>
              <ul className="mt-2 divide-y divide-black/5">
                {activeMemberships.map((m) => (
                  <li key={m.id || m.church_id} className="flex items-center justify-between py-2.5">
                    <Link
                      to={`/churches/${m.church_id}/timeline`}
                      className="text-sm font-medium text-[#174A7E] hover:underline"
                    >
                      {m.church_name || m.church_id}
                    </Link>
                    <span className="rounded-full bg-[#D9A72A]/15 px-2 py-0.5 text-xs font-medium text-[#17212B]">
                      Member
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!loading && !error && pastMemberships.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-[#17212B]/40">
                Past
              </p>
              <ul className="mt-2 divide-y divide-black/5">
                {pastMemberships.map((m) => (
                  <li key={m.id || m.church_id} className="flex items-center justify-between py-2.5">
                    <span className="text-sm text-[#17212B]/60">
                      {m.church_name || m.church_id}
                    </span>
                    <span className="text-xs text-[#17212B]/40">Left</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

// =====================================================================
// 7E. BROWSE / JOIN CHURCHES PAGE
// =====================================================================

/**
 * Protected page listing all churches (optionally filtered by brand/network),
 * with a one-tap join for each. Cross-references the user's existing
 * membership history so already-joined churches show "Joined" instead of
 * a join button — a user can belong to more than one church, so this
 * isn't limited to a single "home church".
 * Route: /churches
 */
function BrowseChurchesPage() {
  const { user } = useAuth();

  const [brands, setBrands] = useState([]);
  const [selectedBrandId, setSelectedBrandId] = useState("");

  const [churches, setChurches] = useState([]);
  const [joinedIds, setJoinedIds] = useState(() => new Set());
  const [joiningId, setJoiningId] = useState(null); // church currently mid-join

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Brand/network filter options — load once.
  useEffect(() => {
    apiGetBrands()
      .then((data) => setBrands(Array.isArray(data) ? data : []))
      .catch(() => {
        /* Non-fatal — filter just won't have options if this fails. */
      });
  }, []);

  // Which churches the user is already an active member of.
  useEffect(() => {
    if (!user?.id) return;
    apiGetUserChurchHistory(user.id)
      .then((history) => {
        const active = (Array.isArray(history) ? history : [])
          .filter((m) => !m.left_at && m.status !== "removed")
          .map((m) => m.church_id);
        setJoinedIds(new Set(active));
      })
      .catch(() => {
        /* Non-fatal — worst case a "Join" button shows for an already-joined church. */
      });
  }, [user?.id]);

  const loadChurches = useCallback(async (brandId) => {
    setLoading(true);
    setError("");
    try {
      const data = await apiGetChurches(brandId ? { brandId } : {});
      setChurches(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || "Couldn't load churches. Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChurches(selectedBrandId);
  }, [selectedBrandId, loadChurches]);

  async function handleJoin(churchId) {
    if (joiningId) return;
    setJoiningId(churchId);
    try {
      await apiJoinChurch(churchId);
      setJoinedIds((prev) => new Set(prev).add(churchId));
    } catch (err) {
      setError(err?.message || "Couldn't join that church. Try again.");
    } finally {
      setJoiningId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#EEF5FB] pb-16">
      <header className="bg-[#174A7E] px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between">
          <Link to="/feed" className="text-sm font-medium text-white/70 hover:text-white">
            ← Back to feed
          </Link>
          <Link to="/churches/new" className="text-sm font-medium text-white/90 hover:text-white">
            + Start a church
          </Link>
        </div>
        <h1 className="mt-1 text-lg font-semibold text-white">Find a church</h1>
      </header>

      <main className="mx-auto max-w-xl px-4 py-6 sm:px-6">
        {brands.length > 0 && (
          <label className="mb-4 block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[#17212B]/50">
              Filter by network
            </span>
            <select
              value={selectedBrandId}
              onChange={(e) => setSelectedBrandId(e.target.value)}
              className="w-full rounded-lg border border-[#17212B]/15 bg-white px-3 py-2 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
            >
              <option value="">All networks</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {loading && <p className="py-8 text-center text-sm text-[#17212B]/50">Loading churches…</p>}

        {!loading && error && (
          <div className="rounded-lg bg-white p-4 text-center ring-1 ring-black/5">
            <p className="mb-3 text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={() => loadChurches(selectedBrandId)}
              className="rounded-lg bg-[#174A7E] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && churches.length === 0 && (
          <div className="rounded-lg bg-white p-8 text-center ring-1 ring-black/5">
            <p className="text-sm text-[#17212B]/60">No churches found for this filter.</p>
          </div>
        )}

        <ul className="flex flex-col gap-3">
          {!loading &&
            !error &&
            churches.map((church) => {
              const joined = joinedIds.has(church.id);
              const joining = joiningId === church.id;
              return (
                <li
                  key={church.id}
                  className="flex items-center justify-between gap-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/churches/${church.id}/timeline`}
                        className="truncate text-sm font-semibold text-[#17212B] hover:underline"
                      >
                        {church.name}
                      </Link>
                      {church.verified && (
                        <span className="shrink-0 rounded-full bg-[#D9A72A]/20 px-2 py-0.5 text-[10px] font-semibold text-[#17212B]">
                          Verified
                        </span>
                      )}
                    </div>
                    {church.description && (
                      <p className="mt-1 truncate text-xs text-[#17212B]/55">
                        {church.description}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleJoin(church.id)}
                    disabled={joined || joining}
                    className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${
                      joined
                        ? "bg-[#D9A72A]/20 text-[#17212B]"
                        : "bg-[#174A7E] text-white hover:opacity-90 disabled:opacity-60"
                    }`}
                  >
                    {joined ? "Joined" : joining ? "Joining…" : "Join"}
                  </button>
                </li>
              );
            })}
        </ul>
      </main>
    </div>
  );
}

// =====================================================================
// 7F. GROUP CHAT PAGE
// =====================================================================

const GC_PAGE_SIZE = 30;

/**
 * Protected group-chat page for a single church.
 * Route: /churches/:churchId/chat
 *
 * ASSUMPTION on message order: GET .../gc/messages with `limit`/`before`
 * reads like a typical chat pagination endpoint — newest messages first,
 * `before` taking a cursor (here, the oldest loaded message's `created_at`)
 * to page further into the past. The list is reversed for display so the
 * chat reads oldest-to-newest, newest at the bottom, same as any chat app.
 * If your real GCMessageOut/pagination behaves differently, flip the
 * `.reverse()` calls below and adjust the `before` cursor field.
 */
function GroupChatPage() {
  const { churchId } = useParams();
  const { user } = useAuth();

  const [church, setChurch] = useState(null);
  const [messages, setMessages] = useState([]); // oldest → newest, for display
  const [hasMore, setHasMore] = useState(true);
  const [draft, setDraft] = useState("");

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const bottomRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    apiGetChurch(churchId)
      .then((data) => {
        if (!cancelled) setChurch(data);
      })
      .catch(() => {
        /* Non-fatal — chat still works without the header name. */
      });
    return () => {
      cancelled = true;
    };
  }, [churchId]);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiListGcMessages(churchId, { limit: GC_PAGE_SIZE });
      const page = Array.isArray(data) ? data : [];
      setMessages([...page].reverse());
      setHasMore(page.length === GC_PAGE_SIZE);
    } catch (err) {
      setError(err?.message || "Couldn't load the chat.");
    } finally {
      setLoading(false);
    }
  }, [churchId]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  // Scroll to the newest message whenever the initial page finishes loading
  // or a new message is sent (not on "load older", which prepends above).
  useEffect(() => {
    if (!loading) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [loading]);

  async function loadOlder() {
    if (loadingMore || messages.length === 0) return;
    setLoadingMore(true);
    try {
      const oldest = messages[0];
      const data = await apiListGcMessages(churchId, {
        limit: GC_PAGE_SIZE,
        before: oldest.created_at || oldest.id,
      });
      const page = Array.isArray(data) ? data : [];
      setMessages((prev) => [...[...page].reverse(), ...prev]);
      setHasMore(page.length === GC_PAGE_SIZE);
    } catch (err) {
      setError(err?.message || "Couldn't load older messages.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleSend(e) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setError("");
    try {
      const newMessage = await apiSendGcMessage(churchId, { content: trimmed });
      setMessages((prev) => [...prev, newMessage]);
      setDraft("");
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: "end" }));
    } catch (err) {
      setError(err?.message || "Message didn't send. Try again.");
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(messageId) {
    // Optimistic removal, roll back if the server rejects it (e.g. not the author).
    const previous = messages;
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    try {
      await apiDeleteGcMessage(churchId, messageId);
    } catch (err) {
      setMessages(previous);
      setError(err?.message || "Couldn't delete that message.");
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#EEF5FB]">
      <header className="bg-[#174A7E] px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between">
          <Link to={`/churches/${churchId}/timeline`} className="text-sm font-medium text-white/70 hover:text-white">
            ← Timeline
          </Link>
        </div>
        <h1 className="mt-1 text-lg font-semibold text-white">
          {church?.name ? `${church.name} — Group Chat` : "Group Chat"}
        </h1>
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 py-4 sm:px-6">
        {!loading && !error && hasMore && messages.length > 0 && (
          <button
            type="button"
            onClick={loadOlder}
            disabled={loadingMore}
            className="mx-auto mb-3 rounded-lg border border-[#174A7E]/20 bg-white px-4 py-1.5 text-xs font-medium text-[#174A7E] hover:bg-[#174A7E]/5 disabled:opacity-60"
          >
            {loadingMore ? "Loading…" : "Load older messages"}
          </button>
        )}

        <div className="flex-1 space-y-2.5">
          {loading && (
            <p className="py-8 text-center text-sm text-[#17212B]/50">Loading chat…</p>
          )}

          {!loading && error && messages.length === 0 && (
            <div className="rounded-lg bg-white p-4 text-center ring-1 ring-black/5">
              <p className="mb-3 text-sm text-red-600">{error}</p>
              <button
                type="button"
                onClick={loadInitial}
                className="rounded-lg bg-[#174A7E] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                Try again
              </button>
            </div>
          )}

          {!loading && !error && messages.length === 0 && (
            <p className="py-8 text-center text-sm text-[#17212B]/60">
              No messages yet — say something to get the conversation going.
            </p>
          )}

          {!loading &&
            messages.map((msg) => {
              const isOwn = msg.author_id === user?.id || msg.user_id === user?.id;
              return (
                <div key={msg.id} className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`group max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${
                      isOwn ? "bg-[#174A7E] text-white" : "bg-white text-[#17212B] shadow-sm ring-1 ring-black/5"
                    }`}
                  >
                    {!isOwn && (
                      <p className="mb-0.5 text-xs font-semibold opacity-70">
                        {msg.author_name || "Member"}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    <div className="mt-1 flex items-center justify-between gap-3">
                      {msg.created_at && (
                        <time
                          className={`text-[10px] ${isOwn ? "text-white/60" : "text-[#17212B]/40"}`}
                        >
                          {new Date(msg.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      )}
                      {isOwn && (
                        <button
                          type="button"
                          onClick={() => handleDelete(msg.id)}
                          className="text-[10px] text-white/60 opacity-0 hover:text-white group-hover:opacity-100"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          <div ref={bottomRef} />
        </div>

        {error && messages.length > 0 && (
          <p className="mt-2 text-center text-xs text-red-600">{error}</p>
        )}

        <form onSubmit={handleSend} className="mt-4 flex items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Message the group…"
            className="flex-1 rounded-full border border-[#17212B]/15 bg-white px-4 py-2.5 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="shrink-0 rounded-full bg-[#D9A72A] px-5 py-2.5 text-sm font-semibold text-[#17212B] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending ? "…" : "Send"}
          </button>
        </form>
      </main>
    </div>
  );
}

// =====================================================================
// 7G. STORIES PAGE
// =====================================================================

const STORY_DURATION_MS = 5000;

/**
 * Protected, church-scoped stories page: a tray of thumbnails up top, a
 * full-screen tap-through viewer, and a form to post a new story (caption
 * + optional image, uploaded via /uploads then attached by media id).
 * Route: /churches/:churchId/stories
 *
 * FIELD-NAME ASSUMPTION: StoryCreate's shape isn't in the spec we have —
 * this sends { content, media_id }. Swap those keys if your real schema
 * calls them something else once you see a StoryCreate example or a 422.
 */
function StoriesPage() {
  const { churchId } = useParams();

  const [church, setChurch] = useState(null);
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [viewerIndex, setViewerIndex] = useState(null); // null = viewer closed
  const [progress, setProgress] = useState(0);

  const [showForm, setShowForm] = useState(false);
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState(null);
  const [posting, setPosting] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiGetChurch(churchId)
      .then((data) => {
        if (!cancelled) setChurch(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [churchId]);

  const loadStories = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiListActiveStories(churchId);
      setStories(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || "Couldn't load stories.");
    } finally {
      setLoading(false);
    }
  }, [churchId]);

  useEffect(() => {
    loadStories();
  }, [loadStories]);

  // ---- full-screen viewer: auto-advance every STORY_DURATION_MS ----
  useEffect(() => {
    if (viewerIndex === null) return;

    setProgress(0);
    const start = Date.now();
    const tick = setInterval(() => {
      const pct = Math.min(100, ((Date.now() - start) / STORY_DURATION_MS) * 100);
      setProgress(pct);
    }, 50);
    const advance = setTimeout(() => {
      setViewerIndex((i) => {
        if (i === null) return i;
        return i + 1 < stories.length ? i + 1 : null; // close after the last one
      });
    }, STORY_DURATION_MS);

    return () => {
      clearInterval(tick);
      clearTimeout(advance);
    };
  }, [viewerIndex, stories.length]);

  function goPrev() {
    setViewerIndex((i) => (i !== null && i > 0 ? i - 1 : i));
  }
  function goNext() {
    setViewerIndex((i) => (i !== null && i + 1 < stories.length ? i + 1 : null));
  }

  async function handlePostStory(e) {
    e.preventDefault();
    const trimmed = caption.trim();
    if (!trimmed && !file) {
      setFormError("Add a caption or an image.");
      return;
    }

    setPosting(true);
    setFormError("");
    try {
      let mediaId;
      if (file) {
        const media = await apiUploadMedia(file);
        mediaId = media?.id;
      }
      const newStory = await apiCreateStory(churchId, {
        content: trimmed || undefined,
        media_id: mediaId,
      });
      setStories((prev) => [newStory, ...prev]);
      setCaption("");
      setFile(null);
      setShowForm(false);
    } catch (err) {
      setFormError(err?.message || "Couldn't post that story. Try again.");
    } finally {
      setPosting(false);
    }
  }

  const activeStory = viewerIndex !== null ? stories[viewerIndex] : null;

  return (
    <div className="min-h-screen bg-[#EEF5FB] pb-16">
      <header className="bg-[#174A7E] px-4 py-4 sm:px-6">
        <Link to={`/churches/${churchId}/timeline`} className="text-sm font-medium text-white/70 hover:text-white">
          ← Timeline
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-white">
          {church?.name ? `${church.name} — Stories` : "Stories"}
        </h1>
      </header>

      <main className="mx-auto max-w-xl px-4 py-6 sm:px-6">
        {/* ---- Story tray ---- */}
        <div className="flex gap-4 overflow-x-auto pb-2">
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="flex shrink-0 flex-col items-center gap-1.5"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-[#174A7E]/40 text-2xl text-[#174A7E]">
              +
            </span>
            <span className="text-xs text-[#17212B]/60">Add story</span>
          </button>

          {loading && (
            <p className="self-center text-sm text-[#17212B]/50">Loading…</p>
          )}

          {!loading &&
            stories.map((story, index) => (
              <button
                key={story.id}
                type="button"
                onClick={() => setViewerIndex(index)}
                className="flex shrink-0 flex-col items-center gap-1.5"
              >
                <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full ring-2 ring-[#D9A72A] ring-offset-2">
                  {story.media_url ? (
                    <img src={story.media_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-[#174A7E] text-lg font-semibold text-white">
                      {(story.author_name || "?").charAt(0).toUpperCase()}
                    </span>
                  )}
                </span>
                <span className="max-w-[4rem] truncate text-xs text-[#17212B]/60">
                  {story.author_name || "Member"}
                </span>
              </button>
            ))}
        </div>

        {!loading && error && (
          <div className="mt-4 rounded-lg bg-white p-4 text-center ring-1 ring-black/5">
            <p className="mb-3 text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={loadStories}
              className="rounded-lg bg-[#174A7E] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && stories.length === 0 && (
          <p className="mt-6 text-center text-sm text-[#17212B]/60">
            No active stories right now — be the first to share one.
          </p>
        )}
      </main>

      {/* ---- Add-story form (simple modal) ---- */}
      {showForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
          <form
            onSubmit={handlePostStory}
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
          >
            <h2 className="mb-3 text-sm font-semibold text-[#17212B]">New story</h2>

            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Say something about this moment…"
              rows={3}
              className="w-full resize-none rounded-lg border border-[#17212B]/15 p-3 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
            />

            <label className="mt-3 block text-xs font-medium text-[#17212B]/60">
              Photo (optional)
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="mt-1 block w-full text-xs text-[#17212B]/70"
              />
            </label>

            {formError && <p className="mt-2 text-sm text-red-600">{formError}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-[#17212B]/60 hover:bg-black/5"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={posting}
                className="rounded-lg bg-[#D9A72A] px-4 py-2 text-sm font-semibold text-[#17212B] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {posting ? "Posting…" : "Post story"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ---- Full-screen viewer ---- */}
      {activeStory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
          {/* Progress bars */}
          <div className="absolute left-3 right-3 top-3 flex gap-1.5">
            {stories.map((_, i) => (
              <div key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
                <div
                  className="h-full bg-white"
                  style={{
                    width: i < viewerIndex ? "100%" : i === viewerIndex ? `${progress}%` : "0%",
                  }}
                />
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setViewerIndex(null)}
            className="absolute right-4 top-8 text-2xl leading-none text-white/80 hover:text-white"
            aria-label="Close"
          >
            ×
          </button>

          <p className="absolute left-4 top-8 text-sm font-medium text-white/90">
            {activeStory.author_name || "Member"}
          </p>

          {/* Tap zones for prev/next */}
          <button
            type="button"
            onClick={goPrev}
            aria-label="Previous story"
            className="absolute left-0 top-0 h-full w-1/3"
          />
          <button
            type="button"
            onClick={goNext}
            aria-label="Next story"
            className="absolute right-0 top-0 h-full w-1/3"
          />

          <div className="flex max-h-full max-w-full flex-col items-center justify-center px-6 text-center">
            {activeStory.media_url && (
              <img
                src={activeStory.media_url}
                alt=""
                className="max-h-[70vh] rounded-lg object-contain"
              />
            )}
            {activeStory.content && (
              <p className="mt-4 max-w-sm text-base leading-relaxed text-white">
                {activeStory.content}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// 7H. CREATE CHURCH PAGE
// =====================================================================

/**
 * Protected page for starting a new church. Any signed-in user can create
 * one per the spec (no admin gate on POST /churches) — they land as its
 * first member and can manage it from there.
 * Route: /churches/new
 */
function CreateChurchPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Give your church a name.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const church = await apiCreateChurch({
        name: trimmedName,
        description: description.trim() || undefined,
      });
      navigate(`/churches/${church.id}/manage`, { replace: true });
    } catch (err) {
      setError(err?.message || "Couldn't create that church. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#EEF5FB] pb-16">
      <header className="bg-[#174A7E] px-4 py-4 sm:px-6">
        <Link to="/churches" className="text-sm font-medium text-white/70 hover:text-white">
          ← Find a church
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-white">Start a church</h1>
      </header>

      <main className="mx-auto max-w-xl px-4 py-6 sm:px-6">
        <form
          onSubmit={handleSubmit}
          className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-black/5"
        >
          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-medium text-[#17212B]">Church name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-[#17212B]/15 px-3 py-2 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
              placeholder="Grace Community Church"
            />
          </label>

          <label className="mb-2 block">
            <span className="mb-1 block text-sm font-medium text-[#17212B]">
              Description <span className="text-[#17212B]/40">(optional)</span>
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border border-[#17212B]/15 p-3 text-sm text-[#17212B] outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
              placeholder="What is your church about?"
            />
          </label>

          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-4 w-full rounded-lg bg-[#D9A72A] py-2.5 text-sm font-semibold text-[#17212B] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Creating…" : "Create church"}
          </button>
        </form>
      </main>
    </div>
  );
}

// =====================================================================
// 7I. MANAGE CHURCH PAGE (admin)
// =====================================================================

/**
 * Protected admin page for a single church: members (add/remove), tags
 * (create + assign/revoke), and a verify button. The spec is explicit
 * that verification is a platform-admin action, not self-service — most
 * users will get a 403 tapping it, and that's surfaced rather than hidden,
 * since there's no field on ChurchOut telling us in advance who's allowed.
 * Route: /churches/:churchId/manage
 */
function ManageChurchPage() {
  const { churchId } = useParams();

  const [church, setChurch] = useState(null);
  const [members, setMembers] = useState([]);
  const [tags, setTags] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(""); // transient success/info messages

  const [newMemberUserId, setNewMemberUserId] = useState("");
  const [addingMember, setAddingMember] = useState(false);

  const [newTagName, setNewTagName] = useState("");
  const [creatingTag, setCreatingTag] = useState(false);

  const [assignUserId, setAssignUserId] = useState("");
  const [assignTagId, setAssignTagId] = useState("");
  const [assigning, setAssigning] = useState(false);

  const [verifying, setVerifying] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [churchData, memberData, tagData] = await Promise.all([
        apiGetChurch(churchId),
        apiListMembers(churchId),
        apiListTags(churchId),
      ]);
      setChurch(churchData);
      setMembers(Array.isArray(memberData) ? memberData : []);
      setTags(Array.isArray(tagData) ? tagData : []);
    } catch (err) {
      setError(err?.message || "Couldn't load this church's admin data.");
    } finally {
      setLoading(false);
    }
  }, [churchId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function handleVerify() {
    setVerifying(true);
    setNotice("");
    setError("");
    try {
      const updated = await apiVerifyChurch(churchId);
      setChurch(updated);
      setNotice("Church verified.");
    } catch (err) {
      // Expect a 403 here for non-platform-admins — that's normal, not a bug.
      setError(
        err?.status === 403
          ? "Verification is a platform-admin action — your account isn't authorized to grant it."
          : err?.message || "Couldn't verify this church."
      );
    } finally {
      setVerifying(false);
    }
  }

  async function handleAddMember(e) {
    e.preventDefault();
    const trimmed = newMemberUserId.trim();
    if (!trimmed) return;

    setAddingMember(true);
    setError("");
    try {
      await apiAddMember(churchId, { user_id: trimmed });
      setNewMemberUserId("");
      const memberData = await apiListMembers(churchId);
      setMembers(Array.isArray(memberData) ? memberData : []);
      setNotice("Member added.");
    } catch (err) {
      setError(err?.message || "Couldn't add that member.");
    } finally {
      setAddingMember(false);
    }
  }

  async function handleRemoveMember(userId) {
    const previous = members;
    setMembers((prev) => prev.filter((m) => m.user_id !== userId));
    try {
      await apiRemoveMember(churchId, userId);
    } catch (err) {
      setMembers(previous);
      setError(err?.message || "Couldn't remove that member.");
    }
  }

  async function handleCreateTag(e) {
    e.preventDefault();
    const trimmed = newTagName.trim();
    if (!trimmed) return;

    setCreatingTag(true);
    setError("");
    try {
      const tag = await apiCreateTag(churchId, { name: trimmed });
      setTags((prev) => [...prev, tag]);
      setNewTagName("");
    } catch (err) {
      setError(err?.message || "Couldn't create that tag.");
    } finally {
      setCreatingTag(false);
    }
  }

  async function handleAssignTag(e) {
    e.preventDefault();
    if (!assignUserId || !assignTagId) return;

    setAssigning(true);
    setError("");
    try {
      await apiAssignTag(churchId, assignUserId, { tag_id: assignTagId });
      setNotice("Tag assigned.");
    } catch (err) {
      setError(err?.message || "Couldn't assign that tag.");
    } finally {
      setAssigning(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#EEF5FB] pb-16">
      <header className="bg-[#174A7E] px-4 py-4 sm:px-6">
        <Link to={`/churches/${churchId}/timeline`} className="text-sm font-medium text-white/70 hover:text-white">
          ← Timeline
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-white">
          {church?.name ? `Manage ${church.name}` : "Manage church"}
        </h1>
      </header>

      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6 sm:px-6">
        {loading && <p className="py-8 text-center text-sm text-[#17212B]/50">Loading…</p>}

        {!loading && (
          <>
            {notice && (
              <p className="rounded-lg bg-[#D9A72A]/15 px-3 py-2 text-center text-sm text-[#17212B]">
                {notice}
              </p>
            )}
            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-600">
                {error}
              </p>
            )}

            {/* ---- Verification ---- */}
            <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-black/5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-[#17212B]">Verification</h2>
                  <p className="mt-0.5 text-xs text-[#17212B]/50">
                    {church?.verified ? "This church is verified." : "Not yet verified."}
                  </p>
                </div>
                {!church?.verified && (
                  <button
                    type="button"
                    onClick={handleVerify}
                    disabled={verifying}
                    className="rounded-lg bg-[#174A7E] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                  >
                    {verifying ? "Requesting…" : "Request verification"}
                  </button>
                )}
              </div>
            </section>

            {/* ---- Members ---- */}
            <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-black/5">
              <h2 className="text-sm font-semibold text-[#17212B]">
                Members ({members.length})
              </h2>

              <ul className="mt-3 divide-y divide-black/5">
                {members.map((m) => (
                  <li key={m.user_id} className="flex items-center justify-between py-2.5">
                    <span className="truncate text-sm text-[#17212B]">
                      {m.user_name || m.user_id}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveMember(m.user_id)}
                      className="text-xs font-medium text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  </li>
                ))}
                {members.length === 0 && (
                  <li className="py-2.5 text-sm text-[#17212B]/50">No members yet.</li>
                )}
              </ul>

              <form onSubmit={handleAddMember} className="mt-4 flex gap-2">
                <input
                  type="text"
                  value={newMemberUserId}
                  onChange={(e) => setNewMemberUserId(e.target.value)}
                  placeholder="User ID to add"
                  className="flex-1 rounded-lg border border-[#17212B]/15 px-3 py-2 text-sm outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
                />
                <button
                  type="submit"
                  disabled={addingMember}
                  className="shrink-0 rounded-lg bg-[#174A7E] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                >
                  {addingMember ? "Adding…" : "Add"}
                </button>
              </form>
            </section>

            {/* ---- Tags ---- */}
            <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-black/5">
              <h2 className="text-sm font-semibold text-[#17212B]">Tags</h2>

              <div className="mt-2 flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="rounded-full bg-[#D9A72A]/15 px-3 py-1 text-xs font-medium text-[#17212B]"
                  >
                    {tag.name}
                  </span>
                ))}
                {tags.length === 0 && (
                  <span className="text-sm text-[#17212B]/50">No tags yet.</span>
                )}
              </div>

              <form onSubmit={handleCreateTag} className="mt-4 flex gap-2">
                <input
                  type="text"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  placeholder="New tag name (e.g. Deacon)"
                  className="flex-1 rounded-lg border border-[#17212B]/15 px-3 py-2 text-sm outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
                />
                <button
                  type="submit"
                  disabled={creatingTag}
                  className="shrink-0 rounded-lg bg-[#174A7E] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                >
                  {creatingTag ? "Creating…" : "Create"}
                </button>
              </form>

              {tags.length > 0 && members.length > 0 && (
                <form onSubmit={handleAssignTag} className="mt-4 flex flex-wrap gap-2">
                  <select
                    value={assignUserId}
                    onChange={(e) => setAssignUserId(e.target.value)}
                    className="flex-1 rounded-lg border border-[#17212B]/15 px-3 py-2 text-sm outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
                  >
                    <option value="">Assign tag to…</option>
                    {members.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.user_name || m.user_id}
                      </option>
                    ))}
                  </select>
                  <select
                    value={assignTagId}
                    onChange={(e) => setAssignTagId(e.target.value)}
                    className="flex-1 rounded-lg border border-[#17212B]/15 px-3 py-2 text-sm outline-none focus:border-[#174A7E] focus:ring-2 focus:ring-[#174A7E]/20"
                  >
                    <option value="">Which tag…</option>
                    {tags.map((tag) => (
                      <option key={tag.id} value={tag.id}>
                        {tag.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={assigning || !assignUserId || !assignTagId}
                    className="shrink-0 rounded-lg bg-[#D9A72A] px-4 py-2 text-sm font-semibold text-[#17212B] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {assigning ? "Assigning…" : "Assign"}
                  </button>
                </form>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

// =====================================================================
// 8. APP + ROUTER
// =====================================================================

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/feed"
            element={
              <ProtectedRoute>
                <FeedPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/churches/:churchId/timeline"
            element={
              <ProtectedRoute>
                <ChurchTimelinePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/churches/:churchId/chat"
            element={
              <ProtectedRoute>
                <GroupChatPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/churches/:churchId/stories"
            element={
              <ProtectedRoute>
                <StoriesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/churches/new"
            element={
              <ProtectedRoute>
                <CreateChurchPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/churches/:churchId/manage"
            element={
              <ProtectedRoute>
                <ManageChurchPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/churches"
            element={
              <ProtectedRoute>
                <BrowseChurchesPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
