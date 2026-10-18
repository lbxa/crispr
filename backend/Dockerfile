# Crispr backend for IBM LinuxONE (s390x).
# Builds on IBM's jupyter-lab-ml image, which already provides Python 3.12 and a
# llama.cpp build with the Telum NNPA (zDNN) backend for Granite.
# Pinned by digest (the image tagged :latest on 2026-10-18); bump deliberately.
FROM registry.linuxone.cloud.marist.edu/l1cc/jupyterlab-image-s390x@sha256:d2da8a7b0c88c3b468e29014b2ada9ef8274f98c976ec456904c5e2bae5aa54c

WORKDIR /home/ibm-user/backend
COPY requirements.txt .
RUN python -m pip install --no-cache-dir -r requirements.txt
COPY crispr_backend ./crispr_backend
COPY scripts ./scripts

# Mount the database built by etl/ (and the GRCh38 hg38.2bit reference under
# /data/reference) at /data, and the big-endian Granite model at /models.
ENV CRISPR_DB=/data/crispr.sqlite \
    CRISPR_REFERENCE_2BIT=/data/reference/hg38.2bit \
    CRISPR_UPLOAD_DIR=/data/uploads \
    GRANITE_GGUF=/models/granite-3.3-2b-instruct-be.Q4_K_M.gguf
EXPOSE 8000
CMD ["uvicorn", "crispr_backend.api:app", "--host", "0.0.0.0", "--port", "8000"]
