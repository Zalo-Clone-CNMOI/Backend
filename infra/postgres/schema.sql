-- =============================================================================
-- ZaloClone Database Schema - PostgreSQL
-- Generated: 2026-01-12
-- =============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- USERS DOMAIN
-- =============================================================================

-- Table: users
-- Lưu trữ thông tin người dùng hệ thống
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(255) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    avatar_url VARCHAR(500),
    bio VARCHAR(500),
    gender VARCHAR(10),
    date_of_birth DATE,
    status VARCHAR(20) DEFAULT 'active',
    last_seen_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE users IS 'Người dùng hệ thống. Là entity chính của ứng dụng.';

CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);

-- Table: device_tokens
-- Lưu trữ device tokens cho push notification
CREATE TABLE IF NOT EXISTS device_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(500) NOT NULL,
    platform VARCHAR(20) NOT NULL, -- ios, android, web
    device_id VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, token)
);

COMMENT ON TABLE device_tokens IS 'Device tokens cho FCM/APNs push notification.';

CREATE INDEX idx_device_tokens_user_id ON device_tokens(user_id);
CREATE INDEX idx_device_tokens_token ON device_tokens(token);

-- =============================================================================
-- CONVERSATIONS DOMAIN
-- =============================================================================

-- Table: conversations
-- Lưu trữ thông tin conversation (nhóm chat hoặc chat 1-1)
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(20) NOT NULL DEFAULT 'direct', -- direct, group
    name VARCHAR(255),
    avatar_url VARCHAR(500),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    last_message_id UUID,
    last_message_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE conversations IS 'Cuộc hội thoại. Type: direct (1-1) hoặc group (nhóm).';

CREATE INDEX idx_conversations_last_message_at ON conversations(last_message_at DESC);
CREATE INDEX idx_conversations_type ON conversations(type);

-- Table: conversation_members
-- Lưu trữ thành viên của mỗi conversation (quan hệ N-N)
CREATE TABLE IF NOT EXISTS conversation_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) DEFAULT 'member', -- owner, admin, member
    nickname VARCHAR(100),
    is_muted BOOLEAN DEFAULT FALSE,
    last_read_at TIMESTAMP,
    joined_at TIMESTAMP DEFAULT NOW(),
    left_at TIMESTAMP,
    UNIQUE(conversation_id, user_id)
);

COMMENT ON TABLE conversation_members IS 'Thành viên conversation. Role: owner, admin, member.';

CREATE INDEX idx_conversation_members_conversation_id ON conversation_members(conversation_id);
CREATE INDEX idx_conversation_members_user_id ON conversation_members(user_id);
CREATE INDEX idx_conversation_members_user_left ON conversation_members(user_id, left_at);

-- =============================================================================
-- FRIENDS/CONTACTS DOMAIN
-- =============================================================================

-- Table: friendships
-- Lưu trữ quan hệ bạn bè giữa users
CREATE TABLE IF NOT EXISTS friendships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, accepted, blocked
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(requester_id, addressee_id)
);

COMMENT ON TABLE friendships IS 'Quan hệ bạn bè. Status: pending, accepted, blocked.';

CREATE INDEX idx_friendships_requester_status ON friendships(requester_id, status);
CREATE INDEX idx_friendships_addressee_status ON friendships(addressee_id, status);

-- =============================================================================
-- MEDIA DOMAIN
-- =============================================================================

-- Table: media_files
-- Lưu trữ metadata của files đã upload
CREATE TABLE IF NOT EXISTS media_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key VARCHAR(500) NOT NULL UNIQUE,
    bucket VARCHAR(100) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    size_bytes BIGINT,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'pending', -- pending, uploaded, deleted
    created_at TIMESTAMP DEFAULT NOW(),
    uploaded_at TIMESTAMP
);

COMMENT ON TABLE media_files IS 'Metadata của files trên S3. Status: pending, uploaded, deleted.';

CREATE INDEX idx_media_files_conversation ON media_files(conversation_id, created_at DESC);
CREATE INDEX idx_media_files_uploaded_by ON media_files(uploaded_by);

-- =============================================================================
-- NHẬT KÝ DOMAIN (TIMELINE / POSTS)
-- =============================================================================

-- Table: posts
-- Lưu trữ bài đăng của users
CREATE TABLE IF NOT EXISTS posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT,
    visibility VARCHAR(20) DEFAULT 'friends', -- public, friends, only_me
    like_count INT DEFAULT 0,
    comment_count INT DEFAULT 0,
    share_count INT DEFAULT 0,
    is_pinned BOOLEAN DEFAULT FALSE,
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE posts IS 'Bài đăng Nhật Ký. Visibility: public, friends, only_me.';

CREATE INDEX idx_posts_user_created ON posts(user_id, created_at DESC);
CREATE INDEX idx_posts_created ON posts(created_at DESC);
CREATE INDEX idx_posts_visibility ON posts(visibility);

-- Table: post_media
-- Lưu trữ media (ảnh/video) đính kèm bài đăng
CREATE TABLE IF NOT EXISTS post_media (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    media_url VARCHAR(500) NOT NULL,
    media_type VARCHAR(20) NOT NULL, -- image, video
    thumbnail_url VARCHAR(500),
    width INT,
    height INT,
    duration_seconds INT,
    display_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE post_media IS 'Media đính kèm bài đăng. Type: image, video.';

CREATE INDEX idx_post_media_post ON post_media(post_id, display_order);

-- Table: post_likes
-- Lưu trữ lượt like/reaction của bài đăng
CREATE TABLE IF NOT EXISTS post_likes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reaction_type VARCHAR(20) DEFAULT 'like', -- like, love, haha, wow, sad, angry
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(post_id, user_id)
);

COMMENT ON TABLE post_likes IS 'Lượt like/reaction bài đăng. Reaction: like, love, haha, wow, sad, angry.';

CREATE INDEX idx_post_likes_post ON post_likes(post_id);
CREATE INDEX idx_post_likes_user ON post_likes(user_id, created_at DESC);

-- Table: post_comments
-- Lưu trữ bình luận của bài đăng
CREATE TABLE IF NOT EXISTS post_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_comment_id UUID REFERENCES post_comments(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    like_count INT DEFAULT 0,
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE post_comments IS 'Bình luận bài đăng. Hỗ trợ reply (nested comments).';

CREATE INDEX idx_post_comments_post ON post_comments(post_id, created_at);
CREATE INDEX idx_post_comments_parent ON post_comments(parent_comment_id);
CREATE INDEX idx_post_comments_user ON post_comments(user_id);

-- Table: comment_likes
-- Lưu trữ lượt like của bình luận
CREATE TABLE IF NOT EXISTS comment_likes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    comment_id UUID NOT NULL REFERENCES post_comments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(comment_id, user_id)
);

COMMENT ON TABLE comment_likes IS 'Lượt like bình luận.';

CREATE INDEX idx_comment_likes_comment ON comment_likes(comment_id);

-- =============================================================================
-- NOTIFICATION DOMAIN
-- =============================================================================

-- Table: notification_preferences
-- Lưu trữ cài đặt notification của user
CREATE TABLE IF NOT EXISTS notification_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    push_enabled BOOLEAN DEFAULT TRUE,
    sound_enabled BOOLEAN DEFAULT TRUE,
    vibrate_enabled BOOLEAN DEFAULT TRUE,
    show_preview BOOLEAN DEFAULT TRUE,
    quiet_hours_start TIME,
    quiet_hours_end TIME,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE notification_preferences IS 'Cài đặt notification của user.';

-- Table: notification_logs
-- Lưu lịch sử notification đã gửi
CREATE TABLE IF NOT EXISTS notification_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel VARCHAR(20) NOT NULL, -- push, email, sms
    provider VARCHAR(50) NOT NULL, -- fcm, apns, mock
    title VARCHAR(255),
    body TEXT,
    data JSONB,
    status VARCHAR(20) NOT NULL, -- sent, failed, pending
    error_message TEXT,
    sent_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE notification_logs IS 'Lịch sử notification đã gửi. Để debug và analytics.';

CREATE INDEX idx_notification_logs_user ON notification_logs(user_id, sent_at DESC);

-- =============================================================================
-- FUNCTIONS & TRIGGERS
-- =============================================================================

-- Function: Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_device_tokens_updated_at BEFORE UPDATE ON device_tokens
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_friendships_updated_at BEFORE UPDATE ON friendships
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_posts_updated_at BEFORE UPDATE ON posts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_post_comments_updated_at BEFORE UPDATE ON post_comments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_notification_preferences_updated_at BEFORE UPDATE ON notification_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- END OF SCHEMA
-- =============================================================================
