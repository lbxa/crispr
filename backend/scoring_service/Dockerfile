# CRISPRon scoring service on IBM's s390x TensorFlow image (TensorFlow 2.4.1, Telum-optimised).
# Build context is backend/. Mount the cloned RTH-tools/crispron repo at /crispron (it holds
# data/deep_models/best/*/ and data/model/energy_dics.pkl) and put the CRISPRoff pipeline
# script in /crispron/bin.
FROM icr.io/ibmz/tensorflow:2.4.1

# ViennaRNA 2.2.5 has C extensions; the CRISPRon environment.yml installs it with Bioconda.
# Install it in the image with conda, then check: RNAfold --version
WORKDIR /app
COPY scoring_service ./scoring_service
ENV CRISPRON_DIR=/crispron PORT=8001
EXPOSE 8001
CMD ["python", "-m", "scoring_service.server"]
