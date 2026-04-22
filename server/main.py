"""
Motion Monitor - FastAPI Backend
MediaPipe Pose 推理服务，通过 WebSocket 接收帧数据，返回姿态关键点
"""

import asyncio
import base64
import io
import json
import logging
import time
from typing import Optional

import cv2
import mediapipe as mp
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

# Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("motion-monitor")

app = FastAPI(title="Motion Monitor API")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# =================== MediaPipe Pose ===================
mp_pose = mp.solutions.pose
pose = mp_pose.Pose(
    static_image_mode=False,
    model_complexity=1,
    smooth_landmarks=True,
    enable_segmentation=False,
    min_detection_confidence=0.6,
    min_tracking_confidence=0.5,
)


def process_frame(image_np: np.ndarray) -> Optional[dict]:
    """处理单帧图像，返回关键点"""
    # MediaPipe needs RGB
    rgb = cv2.cvtColor(image_np, cv2.COLOR_RGBA2RGB) if image_np.shape[2] == 4 else image_np
    results = pose.process(rgb)

    if not results.pose_landmarks:
        return None

    landmarks = []
    for lm in results.pose_landmarks.landmark:
        landmarks.append({
            "x": lm.x,
            "y": lm.y,
            "z": lm.z,
            "visibility": lm.visibility,
        })

    return {"landmarks": landmarks}


def decode_frame(data: dict) -> Optional[np.ndarray]:
    """解码小程序发来的帧数据"""
    try:
        b64_data = data.get("data", "")
        width = data.get("width", 0)
        height = data.get("height", 0)
        fmt = data.get("format", "rgba")

        if not b64_data or not width or not height:
            return None

        # Decode base64 -> bytes -> numpy array
        raw_bytes = base64.b64decode(b64_data)
        img_array = np.frombuffer(raw_bytes, dtype=np.uint8)

        if fmt == "rgba":
            img_array = img_array.reshape((height, width, 4))
        elif fmt == "rgb":
            img_array = img_array.reshape((height, width, 3))
        else:
            # Try JPEG
            img_array = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

        return img_array
    except Exception as e:
        logger.warning(f"Decode frame error: {e}")
        return None


# =================== HTTP Endpoints ===================
@app.get("/")
async def root():
    return {"service": "Motion Monitor API", "status": "running"}


@app.get("/health")
async def health():
    return {"status": "ok", "pose_loaded": pose is not None}


# =================== WebSocket ===================
@app.websocket("/ws/pose")
async def ws_pose(websocket: WebSocket):
    """WebSocket 端点：接收帧数据，返回姿态关键点"""
    await websocket.accept()
    logger.info("WS client connected")

    frame_count = 0
    start_time = time.time()

    try:
        while True:
            # Receive frame data
            raw = await websocket.receive_text()
            data = json.loads(raw)

            if data.get("type") != "frame":
                continue

            # Decode frame
            img_np = decode_frame(data)
            if img_np is None:
                continue

            # Process with MediaPipe
            result = process_frame(img_np)

            frame_count += 1
            elapsed = time.time() - start_time
            fps = frame_count / elapsed if elapsed > 0 else 0

            # Send result
            response = {
                "landmarks": result["landmarks"] if result else None,
                "fps": round(fps, 1),
                "frame": frame_count,
            }

            await websocket.send_text(json.dumps(response))

    except WebSocketDisconnect:
        logger.info(f"WS client disconnected. Total frames: {frame_count}")
    except Exception as e:
        logger.error(f"WS error: {e}")
    finally:
        logger.info("WS session ended")


# =================== HTTP Post fallback ===================
@app.post("/api/pose")
async def api_pose(body: dict):
    """HTTP POST 备选方案：发送单帧图片，返回关键点"""
    img_np = decode_frame(body)
    if img_np is None:
        return {"error": "Invalid frame data"}

    result = process_frame(img_np)
    return {"landmarks": result["landmarks"] if result else None}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
