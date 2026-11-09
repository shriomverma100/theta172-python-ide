/**
 * ModuleNotFoundError → which PyPI package to install.
 *
 * Only modules in this curated list get a one-click install. Installing a
 * guessed name is how typosquatted packages get in, so for anything else the
 * app explains what to do instead of installing.
 */

/** Import name → package name, where they differ. */
const RENAMED = {
  cv2: 'opencv-python',
  sklearn: 'scikit-learn',
  skimage: 'scikit-image',
  PIL: 'pillow',
  yaml: 'pyyaml',
  bs4: 'beautifulsoup4',
  dotenv: 'python-dotenv',
  dateutil: 'python-dateutil',
  docx: 'python-docx',
  pptx: 'python-pptx',
  serial: 'pyserial',
  usb: 'pyusb',
  jwt: 'pyjwt',
  Crypto: 'pycryptodome',
  OpenGL: 'pyopengl',
  win32api: 'pywin32',
  win32con: 'pywin32',
  attr: 'attrs',
  magic: 'python-magic',
  fitz: 'pymupdf',
  Levenshtein: 'levenshtein',
  google_auth_oauthlib: 'google-auth-oauthlib',
  speech_recognition: 'SpeechRecognition',
  telegram: 'python-telegram-bot',
  discord: 'discord.py',
  multipart: 'python-multipart',
  sentence_transformers: 'sentence-transformers',
  llama_cpp: 'llama-cpp-python',
  psycopg2: 'psycopg2-binary',
};

/** Popular packages whose import name is the package name. */
const SAME = new Set([
  'numpy', 'pandas', 'matplotlib', 'seaborn', 'scipy', 'sympy', 'statsmodels', 'plotly', 'bokeh', 'altair',
  'requests', 'httpx', 'aiohttp', 'flask', 'django', 'fastapi', 'uvicorn', 'starlette', 'jinja2', 'werkzeug',
  'torch', 'torchvision', 'torchaudio', 'tensorflow', 'keras', 'jax', 'transformers', 'datasets', 'tokenizers',
  'xgboost', 'lightgbm', 'catboost', 'nltk', 'spacy', 'gensim', 'networkx', 'polars', 'pyarrow', 'duckdb',
  'openpyxl', 'xlrd', 'xlsxwriter', 'tabulate', 'tqdm', 'rich', 'click', 'typer', 'colorama', 'termcolor',
  'pygame', 'pyglet', 'arcade', 'pytest', 'hypothesis', 'black', 'ruff', 'mypy',
  'sqlalchemy', 'pymongo', 'redis', 'boto3', 'openai', 'anthropic', 'langchain', 'streamlit',
  'gradio', 'dash', 'selenium', 'playwright', 'scrapy', 'lxml', 'pydantic', 'emoji', 'faker', 'pyttsx3',
  'pyautogui', 'pyperclip', 'keyboard', 'mouse', 'qrcode', 'wordcloud', 'folium', 'geopandas', 'shapely',
  'numba', 'cython', 'imageio', 'moviepy', 'pydub', 'sounddevice', 'librosa', 'pyqt5', 'pyqt6', 'pyside6',
  'kivy', 'customtkinter', 'ttkbootstrap', 'arrow', 'pendulum', 'pytz', 'ujson', 'orjson', 'markdown',
  'joblib', 'dask', 'ray', 'mlflow', 'optuna', 'shap', 'onnx', 'onnxruntime', 'ollama',
]);

/** Standard-library modules students commonly mistype or expect missing. */
const STDLIB_HINTS = { tkinter: 'tkinter is part of Python. This Python was built without it; choose the built-in Python instead.' };

/**
 * The missing top-level module named in a traceback, or null.
 * "ModuleNotFoundError: No module named 'sklearn.datasets'" → "sklearn"
 */
export function missingModule(text) {
  const m = /ModuleNotFoundError: No module named '([^']+)'/.exec(String(text || ''));
  if (!m) return null;
  const top = m[1].split('.')[0];
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(top) ? top : null;
}

/**
 * What to do about a missing module.
 * @returns {{ module: string, package: string|null, hint: string|null }}
 */
export function packageForModule(module) {
  if (STDLIB_HINTS[module]) return { module, package: null, hint: STDLIB_HINTS[module] };
  if (Object.prototype.hasOwnProperty.call(RENAMED, module)) return { module, package: RENAMED[module], hint: null };
  const lower = module.toLowerCase();
  if (SAME.has(lower)) return { module, package: lower, hint: null };
  return {
    module,
    package: null,
    hint: `"${module}" is not a package THETA172 knows. If it is your own file, check that ${module}.py is in the project folder. If it is on PyPI, check its exact name, then install it from Packages.`,
  };
}
