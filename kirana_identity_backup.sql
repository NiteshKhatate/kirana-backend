--
-- PostgreSQL database dump
--

\restrict StYlSHYs2uhox5McJe2VH007mngGCUFoYwBMZa0chPY8UAmxcBHgRmhUDiQalaG

-- Dumped from database version 17.11 (Debian 17.11-1.pgdg13+2)
-- Dumped by pg_dump version 17.11 (Debian 17.11-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: kirana
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


ALTER TABLE public._prisma_migrations OWNER TO kirana;

--
-- Name: users; Type: TABLE; Schema: public; Owner: kirana
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    full_name text NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    email_verified_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


ALTER TABLE public.users OWNER TO kirana;

--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: kirana
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
3b9f718b-6427-4ff4-ab14-93ef56b14611	66ae8b5553a4fd0aeabca6303c718b534cea9d177b3f1f1d445298c674b56c84	2026-10-12 06:47:35.936555+00	20261012064735_init_identity	\N	\N	2026-10-12 06:47:35.923084+00	1
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: kirana
--

COPY public.users (id, full_name, email, password_hash, email_verified_at, created_at, updated_at) FROM stdin;
\.


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: kirana
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: kirana
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users_email_key; Type: INDEX; Schema: public; Owner: kirana
--

CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);


--
-- PostgreSQL database dump complete
--

\unrestrict StYlSHYs2uhox5McJe2VH007mngGCUFoYwBMZa0chPY8UAmxcBHgRmhUDiQalaG

