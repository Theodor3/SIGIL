"""Attention is a projection; raw execution statuses remain historical evidence."""


def review_flags(mission):
    resolution = mission.get('review_resolution')
    pending = mission.get('status') == 'needs_review' and not resolution
    attention = mission.get('status') in ('needs_review', 'blocked') and (
        not resolution or resolution.get('disposition') == 'evidence_blocked')
    return {'requires_review': pending, 'needs_attention': attention}
